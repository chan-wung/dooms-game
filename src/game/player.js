import { sectorAt } from '../render/bsp.js';
import { HEIGHT, GRAVITY, MAXMOVE, STOPSPEED, FRICTION } from './physics.js';
import { splitMove } from './util.js';
import { newAmmo, newMaxAmmo } from './items.js';
import { newPsprites, tickWeapons, requestWeapon, cycleWeapon } from './weapons.js';

/**
 * 플레이어 (원작 p_user.c / p_mobj.c 의 이동 물리를 35Hz tic 기준으로 재현).
 *  - 방향키로 가속(추력)을 주고 마찰(0.90625/tic)로 감속하는 관성 이동
 *  - 계단은 24 이하까지 오르고, 바닥이 없으면 중력으로 낙하
 *  - 시야 높이: 서 있을 때 41, 걸을 때 상하 흔들림(bob), 계단/착지 시 부드럽게 보정
 */
export const VIEW_HEIGHT = 41;
export const MOUSE_SENS = 0.0025;
const THRUST = 2048 / 65536;  // 명령 1당 추력 (원작: 명령값 × 2048 / 65536)
const MAXBOB = 16;

export class Player {
  constructor(level) {
    const s = level.playerStart;
    this.x = s?.x ?? 0; this.y = s?.y ?? 0;
    this.angle = ((s?.angle ?? 0) * Math.PI) / 180;
    this.momx = 0; this.momy = 0; this.momz = 0;
    this.sector = sectorAt(level, this.x, this.y);
    this.z = this.sector.floorHeight;                 // 발 높이
    this.floorz = this.sector.floorHeight; this.ceilz = this.sector.ceilingHeight;
    this.viewheight = VIEW_HEIGHT; this.deltaViewheight = 0; this.bob = 0;
    this.viewz = this.z + VIEW_HEIGHT;
    this.health = 100; this.armor = 0; this.armorType = 0; // 방어구 종류: 1 = 초록(1/3 흡수), 2 = 파랑(1/2 흡수)
    this.keys = { blue: false, yellow: false, red: false };
    this.ammo = newAmmo(); this.maxAmmo = newMaxAmmo(); this.backpack = false;
    this.weapons = new Set(['fist', 'pistol']);
    this.readyWeapon = 'pistol'; this.pendingWeapon = 'pistol';
    this.psp = newPsprites();                 // 화면에 그리는 무기 스프라이트 상태
    this.attackDown = false; this.refire = 0; this.bulletSlope = 0; this.cmd = null;
    this.extraLight = 0;                      // 총구 화염으로 잠깐 밝아짐
    this.grin = 0; this.fireTics = 0;           // 얼굴 표정용 (무기를 주운 직후 / 계속 쏘는 시간)
    this.damageCount = 0; this.bonusCount = 0; this.attacker = null; this.attackerAngle = 0; this.mass = 100;
    this.powers = { invuln: 0, invis: 0, radsuit: 0, lightamp: 0, berserk: 0, automap: false };   // berserk: 먹은 뒤 지난 tic (0 = 없음)
    this.dead = false; this.noclip = false;
    this.reaction = 0;      // 텔레포트 직후 잠깐 못 움직임
    this.useHeld = false;
    this.snapshot();
  }

  // 전투 대상으로서의 속성 (몬스터가 쏘고 폭발에 휘말리는 대상)
  get radius() { return 16; }
  get height() { return HEIGHT; }
  get isPlayer() { return true; }
  get shootable() { return !this.dead; }
  get fuzz() { return this.powers.invis > 0; }

  /** 다음 맵/저장으로 이어지는 상태 (원작: 체력·방어구·무기·탄약·배낭. 열쇠와 일시 효과는 제외) */
  exportState() {
    return {
      health: this.health, armor: this.armor, armorType: this.armorType,
      ammo: { ...this.ammo }, maxAmmo: { ...this.maxAmmo }, backpack: this.backpack,
      weapons: [...this.weapons], readyWeapon: this.pendingWeapon || this.readyWeapon,
    };
  }

  importState(s) {
    this.health = Math.max(1, s.health); this.armor = s.armor; this.armorType = s.armorType;
    this.ammo = { ...this.ammo, ...s.ammo }; this.maxAmmo = { ...this.maxAmmo, ...s.maxAmmo }; this.backpack = !!s.backpack;
    this.weapons = new Set(s.weapons);
    this.readyWeapon = this.weapons.has(s.readyWeapon) ? s.readyWeapon : 'pistol';
    this.pendingWeapon = this.readyWeapon;
  }

  snapshot() { this.prevX = this.x; this.prevY = this.y; this.prevViewz = this.viewz; this.prevAngle = this.angle; }

  /** tic 사이를 보간한 시점 (alpha: 0..1). colormap: 무적(반전)/빛 증폭 중이면 고정 컬러맵 */
  view(alpha) {
    const p = this.powers;
    // 효과가 끝나기 직전(4초)에는 깜빡여서 곧 끝남을 알려준다 (원작과 같은 규칙)
    const blink = (t) => t > 128 || (t & 8);
    let colormap;
    if (p.invuln > 0 && blink(p.invuln)) colormap = 32;
    else if (p.lightamp > 0 && blink(p.lightamp)) colormap = 1;
    return {
      x: this.prevX + (this.x - this.prevX) * alpha,
      y: this.prevY + (this.y - this.prevY) * alpha,
      z: this.prevViewz + (this.viewz - this.prevViewz) * alpha,
      angle: this.prevAngle + (this.angle - this.prevAngle) * alpha,
      colormap,
      extraLight: this.extraLight,
    };
  }

  /** 마우스 회전: 보간에 영향 없이 즉시 반영 */
  turnBy(delta) { this.angle += delta; this.prevAngle += delta; }

  /** 데미지: 무적이면 무시, 방어구가 일부 흡수 (원작 P_DamageMobj) */
  damage(n, game, source = null) {
    if (this.dead || this.powers.invuln > 0) return;
    if (game.skill === 1) n = Math.floor(n / 2);   // 가장 쉬운 난이도: 피해 절반
    if (this.armorType) {
      let saved = Math.floor(n / (this.armorType === 1 ? 3 : 2));
      if (this.armor <= saved) { saved = this.armor; this.armorType = 0; }
      this.armor -= saved; n -= saved;
    }
    // E1M8 출구 바닥은 죽이지 않고 체력 1 까지만 깎는다
    if (this.sector.special === 11 && n >= this.health) n = this.health - 1;
    this.health -= n;
    this.damageCount = Math.min(100, this.damageCount + n);
    if (source) { this.attacker = source; this.attackerAngle = Math.atan2(source.y - this.y, source.x - this.x); }
    game.lastDamage = n;
    game.hurtFace = 35;   // 얼굴이 아픈 표정을 짓는 시간 (tic)
    game.flashDamage = 6;
    if (this.health <= 0) {
      game.playSound(this.health < -50 ? 'PDIEHI' : 'PLDETH');
      this.health = 0; this.dead = true; game.say('YOU DIED  —  R 키로 다시 시작');
    } else {
      game.playSound('PLPAIN');
    }
  }

  teleportTo(game, x, y, angle) {
    this.x = x; this.y = y; this.angle = angle;
    this.momx = this.momy = this.momz = 0;
    this.sector = sectorAt(game.level, x, y);
    this.z = this.floorz = this.sector.floorHeight; this.ceilz = this.sector.ceilingHeight;
    this.reaction = 18;
    this.viewz = this.z + this.viewheight;
    this.snapshot();
  }

  /**
   * 한 tic 진행. cmd = { forward, side, turn, use } (원작 명령 단위: 걷기 25/24, 달리기 50/40)
   */
  tick(game, cmd) {
    this.snapshot();
    const { physics, specials } = game;

    // 현재 위치의 바닥/천장 (움직이는 바닥/문 반영)
    const r = physics.check(this.x, this.y, this.z);
    this.floorz = r.floorz; this.ceilz = r.ceilz;
    this.sector = sectorAt(game.level, this.x, this.y);
    const onGround = this.z <= this.floorz;

    // 파워업 시간 감소
    for (const k of ['invuln', 'invis', 'radsuit', 'lightamp']) if (this.powers[k] > 0) this.powers[k]--;
    if (this.powers.berserk) this.powers.berserk++;

    // ----- 입력 -----
    if (this.dead) {
      this.viewheight = Math.max(6, this.viewheight - 1);
    } else {
      this.angle += cmd.turn;
      if (this.reaction > 0) this.reaction--;
      else if (onGround || this.noclip) {
        const c = Math.cos(this.angle), s = Math.sin(this.angle);
        this.momx += cmd.forward * THRUST * c + cmd.side * THRUST * s;   // 오른쪽 = (sin, -cos)
        this.momy += cmd.forward * THRUST * s - cmd.side * THRUST * c;
      }
      if (cmd.use && !this.useHeld) specials.useLines(this);
      this.useHeld = cmd.use;
      specials.playerInSpecialSector(this);
    }

    // ----- 이동 -----
    const ox = this.x, oy = this.y;
    this.moveXY(game, cmd);
    if (this.x !== ox || this.y !== oy) specials.crossLines(this, ox, oy);
    this.moveZ();
    if (this.hardLanding) { this.hardLanding = false; game.playSound('OOF'); }
    this.calcHeight(game);

    // 무기: 교체 요청 → 상태 진행 (발사는 무기 상태 머신 안에서 처리)
    if (!this.dead) {
      if (cmd.weapon) requestWeapon(this, cmd.weapon);
      if (cmd.cycle) cycleWeapon(this, cmd.cycle);
    }
    tickWeapons(game, this, cmd);
    if (this.damageCount > 0) this.damageCount--;
    if (this.bonusCount > 0) this.bonusCount--;
    if (this.grin > 0) this.grin--;
    this.fireTics = cmd.fire ? this.fireTics + 1 : 0;
  }

  moveXY(game, cmd) {
    const clamp = (v) => (v > MAXMOVE ? MAXMOVE : v < -MAXMOVE ? -MAXMOVE : v);
    this.momx = clamp(this.momx); this.momy = clamp(this.momy);

    if (this.momx !== 0 || this.momy !== 0) {
      const x0 = this.x, y0 = this.y;
      if (this.noclip) {
        this.x += this.momx; this.y += this.momy;
        this.sector = sectorAt(game.level, this.x, this.y);
        this.floorz = this.sector.floorHeight; this.ceilz = this.sector.ceilingHeight;
      } else {
        // 한 번에 MAXMOVE/2 보다 크게 움직이면 반으로 나눠 이동 (벽 통과 방지)
        let blocked = false;
        splitMove(this.momx, this.momy, MAXMOVE / 2, (px, py) => {
          if (!game.physics.tryMove(this, this.x + px, this.y + py)) {
            blocked = true;
            game.physics.slideMove(this, px, py);
          }
        });
        if (blocked) { this.momx = this.x - x0; this.momy = this.y - y0; } // 벽에 막힌 만큼 운동량 감소
      }
    }

    if (this.z > this.floorz && !this.noclip) return; // 공중에서는 마찰 없음
    const idle = !cmd.forward && !cmd.side;
    if (Math.abs(this.momx) < STOPSPEED && Math.abs(this.momy) < STOPSPEED && idle) {
      this.momx = this.momy = 0;
    } else {
      this.momx *= FRICTION; this.momy *= FRICTION;
    }
  }

  moveZ() {
    if (this.noclip) { this.z = this.floorz; this.momz = 0; return; }
    // 바닥이 올라와 있으면 올라서되, 시야는 부드럽게 따라오게 함
    if (this.z < this.floorz) {
      this.viewheight -= this.floorz - this.z;
      this.deltaViewheight = (VIEW_HEIGHT - this.viewheight) / 8;
      this.z = this.floorz;
    }
    this.z += this.momz;
    if (this.z <= this.floorz) {
      if (this.momz < 0) {
        if (this.momz < -GRAVITY * 8) { this.deltaViewheight = this.momz / 8; this.hardLanding = true; } // 세게 착지하면 시야가 꺼지고 '억' 소리
        this.momz = 0;
      }
      this.z = this.floorz;
    } else if (this.momz === 0) {
      this.momz = -GRAVITY * 2;
    } else {
      this.momz -= GRAVITY;
    }
    if (this.z + HEIGHT > this.ceilz) {
      if (this.momz > 0) this.momz = 0;
      this.z = this.ceilz - HEIGHT;
    }
  }

  calcHeight(game) {
    this.bob = Math.min(MAXBOB, (this.momx * this.momx + this.momy * this.momy) / 4);
    if (this.dead) { this.viewz = this.z + this.viewheight; return; }
    if (this.z > this.floorz) { this.viewz = this.z + VIEW_HEIGHT; return; } // 공중

    const phase = ((409 * game.time) & 8191) / 8192 * Math.PI * 2;
    const bobOffset = (this.bob / 2) * Math.sin(phase);

    this.viewheight += this.deltaViewheight;
    if (this.viewheight > VIEW_HEIGHT) { this.viewheight = VIEW_HEIGHT; this.deltaViewheight = 0; }
    if (this.viewheight < VIEW_HEIGHT / 2) {
      this.viewheight = VIEW_HEIGHT / 2;
      if (this.deltaViewheight <= 0) this.deltaViewheight = 1;
    }
    if (this.deltaViewheight) {
      this.deltaViewheight += 0.25;
      if (!this.deltaViewheight) this.deltaViewheight = 1;
    }
    this.viewz = Math.min(this.z + this.viewheight + bobOffset, this.ceilz - 4);
  }
}

import { Blockmap } from './blockmap.js';
import { Physics, RADIUS, HEIGHT } from './physics.js';
import { Player } from './player.js';
import { Specials } from './specials.js';
import { Mobj, spawnMobjs, kindInfo } from './mobj.js';
import { touchSpecial } from './items.js';
import { ACTIONS, moveMobj, nightmareRespawn } from './monsters.js';
import { setupWeapons } from './weapons.js';
import { sectorAt } from '../render/bsp.js';

/** 아이템 줍는 소리: 무기 = WPNUP, 파워업·소울스피어 = GETPOW, 그 외 ITEMUP */
const PICKUP_SOUND = {
  shotgun: 'WPNUP', chaingun: 'WPNUP', rocketLauncher: 'WPNUP', plasmaGun: 'WPNUP', bfg: 'WPNUP', chainsaw: 'WPNUP',
  soulsphere: 'GETPOW', invulnerability: 'GETPOW', berserk: 'GETPOW', invisibility: 'GETPOW', radsuit: 'GETPOW', automap: 'GETPOW', lightamp: 'GETPOW',
};

/** 한 레벨의 게임 상태와 35Hz 틱 진행 */
export const TICRATE = 35;
const BONUS_ADD = 6;     // 아이템을 주울 때마다 금색 화면 번쩍임이 늘어나는 양 (tic)
const MAX_EFFECTS = 160; // 먼지/피가 한꺼번에 너무 많으면 오래된 것부터 지운다

/** 재현 가능한 난수 (원작 P_Random 처럼 0..255). state 만 저장하면 이어서 같은 수열이 나온다 */
class Rng {
  constructor(seed) { this.state = seed | 0; }
  next() {
    const seed = this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) & 255);
  }
}

export class Game {
  constructor(level, skill = 3, seed = 1, carry = null) {
    this.level = level;
    this.skill = skill;
    this.rng = new Rng(seed);
    this.rnd = () => this.rng.next();
    this.actions = ACTIONS;
    this.validCount = 0;
    this.blockmap = new Blockmap(level);
    this.physics = new Physics(level, this.blockmap);
    this.player = new Player(level);
    this.player.ammoMultiplier = skill === 1 || skill === 5 ? 2 : 1;   // 가장 쉬움/악몽: 탄약 2배
    this.physics.player = this.player;
    this.specials = new Specials(this);
    this.thinkers = [];
    this.time = 0;
    this.secretsFound = 0; this.secretsTotal = 0;
    this.message = ''; this.messageTics = 0;
    this.flashDamage = 0; this.hurtFace = 0;
    this.exited = null;       // { secret } — 출구에 닿으면 설정
    this.specials.spawn();

    // 맵 위의 물체 (아이템, 장식, 몬스터)
    const { mobjs, unknown } = spawnMobjs(level, skill);
    this.mobjs = mobjs;
    this.unknownThings = unknown;           // 아직 모르는 종류 (type → 개수)
    this.physics.things = mobjs.filter((m) => m.solid);
    this.shootables = mobjs.filter((m) => m.shootable);
    this.dirty = false;
    this.itemsFound = 0; this.killsFound = 0;
    this.itemsTotal = mobjs.filter((m) => m.info.countItem).length;
    this.killsTotal = mobjs.filter((m) => m.info.monster).length;

    if (carry) this.player.importState(carry);   // 이전 맵에서 이어받은 체력·무기·탄약
    setupWeapons(this, this.player);
  }

  // ---------- 물체 관리 ----------
  addMobj(m) {
    this.mobjs.push(m);
    if (m.solid) this.physics.things.push(m);
    if (m.shootable) this.shootables.push(m);
    return m;
  }

  /** 투사체/효과 생성 (states.js 의 키) */
  spawnKind(kind, x, y, z) {
    const m = new Mobj(kind, kindInfo(kind), x, y, 0, sectorAt(this.level, x, y));
    m.z = z;
    if (m.ai.effect) {
      // 효과가 너무 많으면 가장 오래된 것부터 정리
      if (this.effectCount >= MAX_EFFECTS) { const old = this.mobjs.find((o) => o.ai?.effect && !o.removed); if (old) this.removeMobj(old); }
      this.effectCount = (this.effectCount || 0) + 1;
    }
    this.mobjs.push(m);
    return m;
  }

  /** 물체를 없앰 (획득, 폭발이 끝남 …). 목록은 tick 끝에서 정리한다 */
  removeMobj(m) {
    if (m.removed) return;
    m.removed = true;
    if (m.ai?.effect) this.effectCount--;
    this.setSolid(m, false);
    this.setShootable(m, false);
    this.dirty = true;
  }

  setSolid(m, on) {
    m.solid = on;
    const list = this.physics.things, i = list.indexOf(m);
    if (!on && i >= 0) list.splice(i, 1);
    else if (on && i < 0) list.push(m);
  }

  setShootable(m, on) {
    m.shootable = on;
    const list = this.shootables, i = list.indexOf(m);
    if (!on && i >= 0) list.splice(i, 1);
    else if (on && i < 0) list.push(m);
  }

  moveMobj(m) { moveMobj(this, m); }
  nightmareRespawn(m) { nightmareRespawn(this, m); }

  /** 플레이어가 닿은 아이템 줍기: 상자가 겹치고 높이가 맞으면 (바닥 -8 ~ 키 56) */
  checkPickups() {
    const p = this.player;
    for (const m of this.mobjs) {
      if (!m.pickup || m.removed) continue;
      const reach = m.radius + RADIUS;
      if (Math.abs(m.x - p.x) >= reach || Math.abs(m.y - p.y) >= reach) continue;
      const dz = m.z - p.z;
      if (dz > HEIGHT || dz < -8) continue;
      if (touchSpecial(this, p, m)) {
        if (m.info.countItem) this.itemsFound++;
        this.playSound(PICKUP_SOUND[m.pickup] ?? 'ITEMUP');
        this.removeMobj(m);
        p.bonusCount += BONUS_ADD;
      }
    }
  }

  /** 효과음 요청 (src = 소리 나는 곳 {x,y}, 없으면 플레이어 자신). 실제 재생은 화면 쪽(onSound)이 한다 */
  playSound(name, src = null) { if (this.onSound) this.onSound(name, src); }

  add(thinker) { this.thinkers.push(thinker); return thinker; }
  say(text) { this.message = text; this.messageTics = 3 * TICRATE; }
  exitLevel(secret) { if (!this.exited) this.exited = { secret, time: this.time }; }

  /** 이 섹터가 움직여서 플레이어가 끼는가 (true = 끼어서 움직일 수 없음) */
  changeSector(sec) {
    const p = this.player;
    if (!this.touches(p, sec)) return false;
    const r = this.physics.check(p.x, p.y, p.z);
    return r.ceilz - r.floorz < HEIGHT;
  }

  touches(p, sec) {
    if (p.sector === sec) return true;
    const l = p.x - RADIUS, r = p.x + RADIUS, b = p.y - RADIUS, t = p.y + RADIUS;
    for (const ld of sec.lines) {
      if (!(r <= ld.minX || l >= ld.maxX || t <= ld.minY || b >= ld.maxY)) return true;
    }
    return false;
  }

  tick(cmd) {
    if (this.exited) return;
    this.time++;
    this.player.tick(this, cmd);
    if (!this.player.dead) this.checkPickups();
    // 틱 도중 새로 생기는 물체(불덩이, 먼지)는 다음 tic 부터 움직인다
    const snapshot = this.mobjs.slice();
    for (const m of snapshot) if (!m.removed) m.tick(this);

    // thinker 실행: 끝난 것(true 반환)은 빼고, 실행 중 add() 된 것은 새 목록에 들어간다
    const running = this.thinkers;
    this.thinkers = [];
    for (const t of running) if (!t.tick()) this.thinkers.push(t);

    if (this.dirty) { this.mobjs = this.mobjs.filter((o) => !o.removed); this.dirty = false; }
    if (this.messageTics > 0 && --this.messageTics === 0) this.message = '';
    if (this.flashDamage > 0) this.flashDamage--;
    if (this.hurtFace > 0) this.hurtFace--;
  }
}

import { Blockmap } from './blockmap.js';
import { Physics, RADIUS, HEIGHT } from './physics.js';
import { Player } from './player.js';
import { Specials } from './specials.js';
import { spawnMobjs } from './mobj.js';
import { touchSpecial } from './items.js';

/** 한 레벨의 게임 상태와 35Hz 틱 진행 */
export const TICRATE = 35;

export class Game {
  constructor(level, skill = 3) {
    this.level = level;
    this.skill = skill;
    this.blockmap = new Blockmap(level);
    this.physics = new Physics(level, this.blockmap);
    this.player = new Player(level);
    this.specials = new Specials(this);
    this.thinkers = [];
    this.time = 0;
    this.secretsFound = 0; this.secretsTotal = 0;
    this.message = ''; this.messageTics = 0;
    this.flashDamage = 0; this.pickupFlash = 0;
    this.exited = null;       // { secret } — 출구에 닿으면 설정
    this.specials.spawn();

    // 맵 위의 물체 (아이템, 장식, 몬스터)
    const { mobjs, unknown } = spawnMobjs(level, skill);
    this.mobjs = mobjs;
    this.unknownThings = unknown;           // 아직 모르는 종류 (type → 개수)
    this.physics.things = mobjs.filter((m) => m.solid);
    this.itemsFound = 0; this.killsFound = 0;
    this.itemsTotal = mobjs.filter((m) => m.info.countItem).length;
    this.killsTotal = mobjs.filter((m) => m.info.monster).length;
  }

  /** 물체를 없앰 (획득, 죽음 …). 충돌 목록도 갱신 */
  removeMobj(m) {
    m.removed = true;
    this.mobjs = this.mobjs.filter((o) => !o.removed);
    const i = this.physics.things.indexOf(m);
    if (i >= 0) this.physics.things.splice(i, 1);
  }

  /** 플레이어가 닿은 아이템 줍기: 상자가 겹치고 높이가 맞으면 (바닥 -8 ~ 키 56) */
  checkPickups() {
    const p = this.player;
    for (const m of this.mobjs) {
      if (!m.pickup) continue;
      const reach = m.radius + RADIUS;
      if (Math.abs(m.x - p.x) >= reach || Math.abs(m.y - p.y) >= reach) continue;
      const dz = m.z - p.z;
      if (dz > HEIGHT || dz < -8) continue;
      if (touchSpecial(this, p, m)) {
        if (m.info.countItem) this.itemsFound++;
        this.removeMobj(m);
        this.pickupFlash = 4;
      }
    }
  }

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
    for (const m of this.mobjs) m.tick();

    // thinker 실행: 끝난 것(true 반환)은 빼고, 실행 중 add() 된 것은 새 목록에 들어간다
    const running = this.thinkers;
    this.thinkers = [];
    for (const t of running) if (!t.tick()) this.thinkers.push(t);

    if (this.messageTics > 0 && --this.messageTics === 0) this.message = '';
    if (this.flashDamage > 0) this.flashDamage--;
    if (this.pickupFlash > 0) this.pickupFlash--;
  }
}

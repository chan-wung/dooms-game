import { Blockmap } from './blockmap.js';
import { Physics, RADIUS, HEIGHT } from './physics.js';
import { Player } from './player.js';
import { Specials } from './specials.js';

/** 한 레벨의 게임 상태와 35Hz 틱 진행 */
export const TICRATE = 35;

export class Game {
  constructor(level) {
    this.level = level;
    this.blockmap = new Blockmap(level);
    this.physics = new Physics(level, this.blockmap);
    this.player = new Player(level);
    this.specials = new Specials(this);
    this.thinkers = [];
    this.time = 0;
    this.secretsFound = 0; this.secretsTotal = 0;
    this.message = ''; this.messageTics = 0;
    this.flashDamage = 0;
    this.exited = null;       // { secret } — 출구에 닿으면 설정
    this.specials.spawn();
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

    // thinker 실행: 끝난 것(true 반환)은 빼고, 실행 중 add() 된 것은 새 목록에 들어간다
    const running = this.thinkers;
    this.thinkers = [];
    for (const t of running) if (!t.tick()) this.thinkers.push(t);

    if (this.messageTics > 0 && --this.messageTics === 0) this.message = '';
    if (this.flashDamage > 0) this.flashDamage--;
  }
}

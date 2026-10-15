import { sectorAt } from '../render/bsp.js';
import { LINE_FLAGS } from '../wad/level.js';

/**
 * 충돌/이동 (원작 p_map.c 의 P_CheckPosition / P_TryMove / P_SlideMove 를 단순화).
 *  - 몸통은 반지름 16의 정사각형 상자, 키 56. 선과 겹치면(상자가 선을 가로지르면) 그 선을 검사한다.
 *  - 선이 막는 조건: 한쪽 벽 / BLOCKING 플래그 / 틈이 키보다 좁음 / 머리가 천장에 닿음 / 오를 턱이 24 초과.
 */
export const RADIUS = 16;
export const HEIGHT = 56;
export const STEP_HEIGHT = 24;

/** 상자가 선을 가로지르는가 (모서리 4개가 선 양쪽에 걸쳐 있으면 true) */
const boxStraddles = (ld, l, b, r, t) => {
  const ax = ld.v1.x, ay = ld.v1.y;
  const c1 = ld.dx * (b - ay) - ld.dy * (l - ax);
  const c2 = ld.dx * (b - ay) - ld.dy * (r - ax);
  const c3 = ld.dx * (t - ay) - ld.dy * (l - ax);
  const c4 = ld.dx * (t - ay) - ld.dy * (r - ax);
  const lo = Math.min(c1, c2, c3, c4), hi = Math.max(c1, c2, c3, c4);
  return lo < 0 && hi > 0;
};

export class Physics {
  constructor(level, blockmap) {
    this.level = level;
    this.blockmap = blockmap;
    /** check() 의 결과 (재사용 객체) */
    this.result = { floorz: 0, ceilz: 0, blocked: false, blockers: [] };
  }

  /** (x, y) 에 키 height 인 것이 z 높이로 서 있을 수 있는가 */
  check(x, y, z, height = HEIGHT, radius = RADIUS) {
    const r = this.result;
    r.blockers.length = 0;
    const left = x - radius, right = x + radius, bottom = y - radius, top = y + radius;
    const sec = sectorAt(this.level, x, y);
    let floorz = sec.floorHeight, ceilz = sec.ceilingHeight;

    this.blockmap.forEachLine(left, bottom, right, top, (ld) => {
      if (right <= ld.minX || left >= ld.maxX || top <= ld.minY || bottom >= ld.maxY) return;
      if (!boxStraddles(ld, left, bottom, right, top)) return;

      let blocks = false;
      if (!ld.backSector || (ld.flags & LINE_FLAGS.BLOCKING)) {
        blocks = true;
      } else {
        const f = ld.frontSector, b = ld.backSector;
        const openTop = Math.min(f.ceilingHeight, b.ceilingHeight);
        const openBottom = Math.max(f.floorHeight, b.floorHeight);
        if (openTop < ceilz) ceilz = openTop;
        if (openBottom > floorz) floorz = openBottom;
        if (openTop - openBottom < height || openTop - z < height || openBottom - z > STEP_HEIGHT) blocks = true;
      }
      if (blocks) r.blockers.push(ld);
    });

    r.floorz = floorz; r.ceilz = ceilz;
    r.blocked = r.blockers.length > 0 || ceilz - floorz < height || ceilz - z < height || floorz - z > STEP_HEIGHT;
    return r;
  }

  /** mo = { x, y, z, floorz, ceilz, sector }. 막히지 않으면 이동하고 true */
  tryMove(mo, nx, ny) {
    const r = this.check(nx, ny, mo.z);
    if (r.blocked) return false;
    mo.x = nx; mo.y = ny;
    mo.floorz = r.floorz; mo.ceilz = r.ceilz;
    mo.sector = sectorAt(this.level, nx, ny);
    return true;
  }

  /**
   * 이동 시도 후 막히면 벽을 따라 미끄러진다.
   * 1) 막히기 직전까지(이분 탐색) 가고 2) 가장 정면으로 막은 선을 골라 남은 이동을 그 선과 평행하게 바꿔 다시 시도 (최대 3번).
   */
  slideMove(mo, mx, my) {
    let dx = mx, dy = my;
    for (let iter = 0; iter < 3; iter++) {
      if (this.tryMove(mo, mo.x + dx, mo.y + dy)) return;

      const x0 = mo.x, y0 = mo.y;
      let lo = 0, hi = 1;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (this.check(x0 + dx * mid, y0 + dy * mid, mo.z).blocked) hi = mid; else lo = mid;
      }
      if (lo > 0) this.tryMove(mo, x0 + dx * lo, y0 + dy * lo);

      // 막은 선들을 이동 방향에 수직인 정도 순으로 정렬
      this.check(x0 + dx * hi, y0 + dy * hi, mo.z);
      const rx = dx * (1 - lo), ry = dy * (1 - lo);
      const cands = this.result.blockers.map((ld) => {
        const len = Math.hypot(ld.dx, ld.dy);
        return {
          n: Math.abs(rx * ld.dy - ry * ld.dx) / len,                                   // 선에 수직인 성분 (클수록 정면)
          sx: (ld.dx * (rx * ld.dx + ry * ld.dy)) / (len * len),                        // 선 방향으로 투영한 이동
          sy: (ld.dy * (rx * ld.dx + ry * ld.dy)) / (len * len),
        };
      }).sort((a, b) => b.n - a.n);
      if (!cands.length) return;

      // 모서리에서는 선 두 개가 동시에 막으므로, 실제로 갈 수 있는 쪽으로 미끄러지는 것을 고른다
      let pick = cands[0];
      for (const c of cands) {
        if (Math.hypot(c.sx, c.sy) < 0.01) continue;
        if (!this.check(mo.x + c.sx, mo.y + c.sy, mo.z).blocked) { pick = c; break; }
      }
      dx = pick.sx; dy = pick.sy;
      if (Math.hypot(dx, dy) < 0.01) return;
    }
  }

  /** 점 (x,y) 가 선의 어느 쪽인가: 0 = 앞(오른쪽), 1 = 뒤 */
  static pointOnLineSide(ld, x, y) {
    return ld.dx * (y - ld.v1.y) - ld.dy * (x - ld.v1.x) < 0 ? 0 : 1;
  }

  /**
   * 선분 (x0,y0)→(x1,y1) 이 선 ld 와 교차하는가. 교차하면 선분 위 비율(0..1), 아니면 -1
   */
  static intersect(ld, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const den = dx * ld.dy - dy * ld.dx;
    if (den === 0) return -1;
    const t = ((ld.v1.x - x0) * ld.dy - (ld.v1.y - y0) * ld.dx) / den; // 이동 선분 위 위치
    const u = ((ld.v1.x - x0) * dy - (ld.v1.y - y0) * dx) / den;       // 선 위 위치
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  }
}

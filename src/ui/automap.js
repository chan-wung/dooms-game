import { LINE_FLAGS } from '../wad/level.js';

/**
 * 2D 오토맵. 맵 좌표(y 위쪽 +)를 화면 좌표로 변환해 LINEDEFS를 그린다.
 * 원작 오토맵 색 규칙: 외벽 빨강 / 바닥 높이 변화 갈색 / 천장 높이 변화 노랑 / 높이 변화 없는 양면선은 숨김(디버그 모드에선 회색).
 */
const COLORS = {
  wall: '#fc0000',
  floorChange: '#bc7840',
  ceilingChange: '#fcfc00',
  secret: '#ff40ff',
  flat: '#3c3c46',
  thing: '#58a0ff',
  player: '#7dff8a',
};

export class Automap {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = null;
    this.scale = 0.2;           // 화면 px / 맵 유닛
    this.cx = 0; this.cy = 0;   // 화면 중심에 놓일 맵 좌표
    this.follow = true;
    this.showFlat = false;      // 높이 변화 없는 양면선 표시
    this.showThings = false;
  }

  /** player: { x, y, angle(라디안) } — 게임과 공유하는 객체 */
  setLevel(level, player) {
    this.level = level;
    this.player = player;
    this.fit();
  }

  /** 따라가기 모드면 화면 중심을 플레이어에 맞춤 */
  tick() {
    if (this.follow) { this.cx = this.player.x; this.cy = this.player.y; }
  }

  /** 맵 전체가 화면에 들어오도록 */
  fit() {
    const { minX, minY, maxX, maxY } = this.level.bounds;
    this.cx = (minX + maxX) / 2; this.cy = (minY + maxY) / 2;
    this.scale = Math.min(this.canvas.width / (maxX - minX + 64), this.canvas.height / (maxY - minY + 64));
  }

  /** 커서 위치(px)를 고정점으로 확대/축소 */
  zoomAt(px, py, factor) {
    const before = this.toMap(px, py);
    this.scale = Math.min(4, Math.max(0.02, this.scale * factor));
    const after = this.toMap(px, py);
    this.cx += before.x - after.x; this.cy += before.y - after.y;
  }

  panBy(dxPx, dyPx) {
    this.cx -= dxPx / this.scale; this.cy += dyPx / this.scale;
  }

  toScreen(x, y) {
    return [
      (x - this.cx) * this.scale + this.canvas.width / 2,
      -(y - this.cy) * this.scale + this.canvas.height / 2,
    ];
  }

  toMap(px, py) {
    return {
      x: (px - this.canvas.width / 2) / this.scale + this.cx,
      y: -(py - this.canvas.height / 2) / this.scale + this.cy,
    };
  }

  lineColor(l) {
    if (l.flags & LINE_FLAGS.SECRET) return COLORS.secret;
    if (!l.left || !l.right) return COLORS.wall;
    const a = l.right.sector, b = l.left.sector;
    if (a.floorHeight !== b.floorHeight) return COLORS.floorChange;
    if (a.ceilingHeight !== b.ceilingHeight) return COLORS.ceilingChange;
    return this.showFlat ? COLORS.flat : null;
  }

  draw() {
    const { ctx, canvas, level } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!level) return;

    ctx.lineWidth = 1;
    // 색별로 묶어 한 번에 stroke → 호출 수 절감
    const batches = new Map();
    for (const l of level.linedefs) {
      const c = this.lineColor(l);
      if (!c) continue;
      if (!batches.has(c)) batches.set(c, []);
      batches.get(c).push(l);
    }
    for (const [color, lines] of batches) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const l of lines) {
        const [x1, y1] = this.toScreen(l.v1.x, l.v1.y);
        const [x2, y2] = this.toScreen(l.v2.x, l.v2.y);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }

    if (this.showThings) {
      ctx.fillStyle = COLORS.thing;
      for (const t of level.things) {
        const [x, y] = this.toScreen(t.x, t.y);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    // 플레이어 화살표
    const p = this.player;
    const [px, py] = this.toScreen(p.x, p.y);
    const a = -p.angle; // 화면 y 반전
    const r = Math.max(8, 16 * this.scale * 5);
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
    ctx.lineTo(px + Math.cos(a + 2.5) * r * 0.7, py + Math.sin(a + 2.5) * r * 0.7);
    ctx.lineTo(px + Math.cos(a - 2.5) * r * 0.7, py + Math.sin(a - 2.5) * r * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

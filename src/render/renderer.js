import { NF_SUBSECTOR, pointOnSide } from './bsp.js';

/**
 * BSP 렌더러 (Phase 2: 단색).
 *  - BSP를 앞→뒤로 순회하며 seg를 그린다.
 *  - 화면 열(column)마다 "아직 열려 있는 세로 구간"을 ceilClip/floorClip에 기록해 가림(occlusion)을 처리한다.
 *    단면 벽은 열을 닫고, 양면 벽은 상/하단 벽만 그린 뒤 열린 구간을 좁힌다.
 *  - 행 경계는 픽셀 중심(y + 0.5) 기준: 경계 y(실수) 위쪽 행 = ceil(y - 0.5) 미만.
 *  - 시야각 90° (원작과 동일), 320×200 내부 해상도 (표시 시 4:3으로 늘림).
 */
export const SCREEN_W = 320;
export const SCREEN_H = 200;
const W = SCREEN_W, H = SCREEN_H;
const HALF_W = W / 2, HALF_H = H / 2;
const FOCAL = HALF_W;   // 90° FOV
const NEAR = 1;
const SKY_FLAT = 'F_SKY1';
const SKY_COLOR = 0xffc88c5a; // ABGR

// ---------- 색 (텍스처 이름 해시 → 고정 색. Phase 3에서 실제 텍스처로 교체) ----------
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const hslToRgb = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};
const colorCache = new Map();
const texColor = (name, sat, light) => {
  const key = `${name}|${sat}|${light}`;
  let c = colorCache.get(key);
  if (!c) {
    c = name === '-' ? [light * 255 | 0, light * 255 | 0, light * 255 | 0]
      : hslToRgb((hash(name) % 360) / 360, sat, light);
    colorCache.set(key, c);
  }
  return c;
};

/** 섹터 조명 + 거리 → 0..1 밝기 */
const brightness = (light, z) => {
  const b = (light / 255) * (1.15 - (Math.min(z, 2400) / 2400) * 0.85);
  return b < 0.06 ? 0.06 : b > 1 ? 1 : b;
};
const pack = (c, b) => 0xff000000 | (((c[2] * b) | 0) << 16) | (((c[1] * b) | 0) << 8) | ((c[0] * b) | 0);

/** 경계 y(실수) → 그 아래가 시작되는 행 번호 [0, H] */
const bound = (y) => {
  const r = Math.ceil(y - 0.5);
  return r < 0 ? 0 : r > H ? H : r;
};

export class Renderer {
  constructor() {
    this.pixels = new Uint32Array(W * H);
    this.ceilClip = new Int16Array(W);   // 각 열에서 아직 안 그려진 첫 행
    this.floorClip = new Int16Array(W);  // 각 열에서 아직 안 그려진 마지막 행 + 1
    this.openCols = W;
    this.segsDrawn = 0;
  }

  /**
   * @param level loadLevel() 결과
   * @param view  { x, y, angle(라디안, 반시계 +), z(눈높이) }
   */
  render(level, view) {
    this.level = level;
    this.px = view.x; this.py = view.y; this.eyeZ = view.z;
    this.cos = Math.cos(view.angle); this.sin = Math.sin(view.angle);

    this.pixels.fill(0xff000000);
    this.ceilClip.fill(0);
    this.floorClip.fill(H);
    this.openCols = W;
    this.segsDrawn = 0;

    this.walk(level.nodes.length ? level.nodes.length - 1 : NF_SUBSECTOR);
  }

  // ---------- BSP 순회 ----------
  walk(n) {
    if (n & NF_SUBSECTOR) { this.drawSubsector(n & ~NF_SUBSECTOR); return; }
    const node = this.level.nodes[n];
    const side = pointOnSide(this.px, this.py, node);
    this.walk(node.children[side]);                                   // 시점이 있는 쪽 먼저
    if (this.openCols > 0 && this.checkBBox(node.bbox[side ^ 1])) this.walk(node.children[side ^ 1]);
  }

  /** 바운딩 박스가 화면의 열린 열과 겹칠 가능성이 있는가 (보수적 판정) */
  checkBBox(b) {
    const { px, py, cos, sin } = this;
    if (px >= b.left && px <= b.right && py >= b.bottom && py <= b.top) return true;

    let behind = 0, minX = Infinity, maxX = -Infinity;
    const xs = [b.left, b.right], ys = [b.bottom, b.top];
    for (const cx of xs) {
      for (const cy of ys) {
        const dx = cx - px, dy = cy - py;
        const z = dx * cos + dy * sin;
        if (z < NEAR) { behind++; continue; }
        const sx = HALF_W + ((dx * sin - dy * cos) * FOCAL) / z;
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      }
    }
    if (behind === 4) return false;
    if (behind > 0) return true; // 일부가 카메라 뒤 → 정확한 범위를 알 수 없으므로 보수적으로 통과

    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(W - 1, Math.ceil(maxX));
    for (let x = x0; x <= x1; x++) if (this.ceilClip[x] < this.floorClip[x]) return true;
    return false;
  }

  drawSubsector(i) {
    const ss = this.level.subsectors[i];
    const segs = this.level.segs;
    for (let s = 0; s < ss.segCount; s++) this.drawSeg(segs[ss.firstSeg + s]);
  }

  // ---------- seg ----------
  drawSeg(seg) {
    const { px, py, cos, sin, eyeZ, pixels, ceilClip, floorClip } = this;
    const ax = seg.v1.x, ay = seg.v1.y, bx = seg.v2.x, by = seg.v2.y;

    // 앞면은 seg 진행 방향의 오른쪽. 시점이 뒤쪽(또는 선 위)이면 건너뜀
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0) return;

    // 시점 공간: z = 앞(깊이), x = 오른쪽
    let dx = ax - px, dy = ay - py;
    let z1 = dx * cos + dy * sin, x1 = dx * sin - dy * cos;
    dx = bx - px; dy = by - py;
    let z2 = dx * cos + dy * sin, x2 = dx * sin - dy * cos;

    // 근평면 클리핑
    if (z1 < NEAR && z2 < NEAR) return;
    if (z1 < NEAR) { const t = (NEAR - z1) / (z2 - z1); x1 += (x2 - x1) * t; z1 = NEAR; }
    else if (z2 < NEAR) { const t = (NEAR - z2) / (z1 - z2); x2 += (x1 - x2) * t; z2 = NEAR; }

    const inv1 = 1 / z1, inv2 = 1 / z2;                 // 1/z 는 화면 x에 선형
    const sx1 = HALF_W + x1 * FOCAL * inv1, sx2 = HALF_W + x2 * FOCAL * inv2;
    if (sx2 <= sx1) return;
    const xs = Math.max(0, Math.ceil(sx1 - 0.5));
    const xe = Math.min(W - 1, Math.ceil(sx2 - 0.5) - 1);
    if (xs > xe) return;
    this.segsDrawn++;

    // 앞/뒤 섹터와 벽 종류 결정
    const front = seg.frontSector, back = seg.backSector;
    const fCeil = front.ceilingHeight, fFloor = front.floorHeight;
    let bCeil = 0, bFloor = 0, solid = !back;
    if (back) {
      bCeil = back.ceilingHeight; bFloor = back.floorHeight;
      if (bCeil <= fFloor || bFloor >= fCeil) solid = true;              // 닫힌 문
      if (front.ceilingTex === SKY_FLAT && back.ceilingTex === SKY_FLAT) bCeil = fCeil; // 하늘끼리는 상단 벽 없음
    }
    const side = seg.frontSide;
    const light = front.light + (ay === by ? -16 : ax === bx ? 16 : 0); // 원작의 방향별 명암 대비
    const midC = texColor(side.midTex !== '-' ? side.midTex : side.upperTex !== '-' ? side.upperTex : side.lowerTex, 0.3, 0.5);
    const upperC = texColor(side.upperTex, 0.3, 0.5);
    const lowerC = texColor(side.lowerTex, 0.3, 0.45);
    const fcol = front.fcol || (front.fcol = texColor(front.floorTex, 0.35, 0.36));
    const ccol = front.ccol || (front.ccol = texColor(front.ceilingTex, 0.25, 0.3));
    const skyCeil = front.ceilingTex === SKY_FLAT;

    const span = sx2 - sx1, dInv = inv2 - inv1;
    for (let x = xs; x <= xe; x++) {
      const top = ceilClip[x], bot = floorClip[x];
      if (top >= bot) continue;

      const invz = inv1 + ((x + 0.5 - sx1) / span) * dInv;
      const z = 1 / invz, scale = FOCAL * invz;
      const yCF = bound(HALF_H - (fCeil - eyeZ) * scale);
      const yFF = bound(HALF_H - (fFloor - eyeZ) * scale);
      const br = brightness(light, z);

      // 천장
      this.plane(x, top, Math.min(yCF, bot), fCeil, ccol, front.light, skyCeil);

      let newTop, newBot;
      if (solid) {
        const c = pack(!back ? midC : upperC, br);
        for (let y = Math.max(yCF, top), e = Math.min(yFF, bot); y < e; y++) pixels[y * W + x] = c;
        newTop = H; newBot = 0;
      } else {
        const yCB = bound(HALF_H - (bCeil - eyeZ) * scale);
        const yFB = bound(HALF_H - (bFloor - eyeZ) * scale);
        if (bCeil < fCeil) {                                  // 상단 벽
          const c = pack(upperC, br);
          for (let y = Math.max(yCF, top), e = Math.min(yCB, bot); y < e; y++) pixels[y * W + x] = c;
        }
        if (bFloor > fFloor) {                                // 하단 벽
          const c = pack(lowerC, br);
          for (let y = Math.max(yFB, top), e = Math.min(yFF, bot); y < e; y++) pixels[y * W + x] = c;
        }
        newTop = Math.max(top, yCF, yCB);
        newBot = Math.min(bot, yFF, yFB);
      }

      // 바닥
      this.plane(x, Math.max(yFF, top), bot, fFloor, fcol, front.light, false);

      ceilClip[x] = newTop; floorClip[x] = newBot;
      if (newTop >= newBot) this.openCols--;
    }
  }

  /** 한 열에서 바닥/천장 [y0, y1) 행을 채움. 행마다 깊이가 달라 밝기가 변한다 */
  plane(x, y0, y1, planeH, color, light, sky) {
    if (y0 >= y1) return;
    const pixels = this.pixels;
    if (sky) { for (let y = y0; y < y1; y++) pixels[y * W + x] = SKY_COLOR; return; }
    const k = Math.abs(planeH - this.eyeZ) * FOCAL;
    for (let y = y0; y < y1; y++) {
      const dy = Math.abs(y + 0.5 - HALF_H);
      pixels[y * W + x] = pack(color, brightness(light, k / (dy < 0.5 ? 0.5 : dy)));
    }
  }
}

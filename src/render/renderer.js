import { NF_SUBSECTOR, pointOnSide } from './bsp.js';
import { LINE_FLAGS } from '../wad/level.js';

/**
 * BSP 렌더러 (Phase 3: 텍스처 + 원작 방식 조명).
 *  - BSP를 앞→뒤로 순회하며 seg를 그린다.
 *  - 화면 열(column)마다 "아직 열려 있는 세로 구간"을 ceilClip/floorClip에 기록해 가림(occlusion)을 처리한다.
 *    단면 벽은 열을 닫고, 양면 벽은 상/하단 벽만 그린 뒤 열린 구간을 좁힌다.
 *  - 행 경계는 픽셀 중심(y + 0.5) 기준: 경계 y(실수) 위쪽 행 = ceil(y - 0.5) 미만.
 *  - 시야각 90° (원작과 동일), 320×200 내부 해상도 (표시 시 4:3으로 늘림).
 *  - 바닥/천장은 열 단위로 픽셀마다 월드 좌표를 역산해 flat을 샘플링한다 (visplane 없이 단순화).
 */
export const SCREEN_W = 320;
export const SCREEN_H = 200;
const W = SCREEN_W, H = SCREEN_H;
const HALF_W = W / 2, HALF_H = H / 2;
const FOCAL = HALF_W;   // 90° FOV
const NEAR = 1;
const SKY_FLAT = 'F_SKY1';

// ---------- 조명 테이블 (원작 r_main.c R_InitLightTables 와 동일한 식) ----------
const LIGHTLEVELS = 16, MAXLIGHTSCALE = 48, MAXLIGHTZ = 128, NUMCOLORMAPS = 32;
const clampMap = (l) => (l < 0 ? 0 : l >= NUMCOLORMAPS ? NUMCOLORMAPS - 1 : l);
/** scaleLight[밝기구간][floor(scale*16)] → colormap 번호 (벽용: 화면 배율 기준) */
const scaleLight = Array.from({ length: LIGHTLEVELS }, (_, i) => {
  const start = (LIGHTLEVELS - 1 - i) * 4;
  return Uint8Array.from({ length: MAXLIGHTSCALE }, (_, j) => clampMap(start - (j >> 1)));
});
/** zLight[밝기구간][floor(깊이/16)] → colormap 번호 (바닥/천장용: 깊이 기준) */
const zLight = Array.from({ length: LIGHTLEVELS }, (_, i) => {
  const start = (LIGHTLEVELS - 1 - i) * 4;
  return Uint8Array.from({ length: MAXLIGHTZ }, (_, j) => clampMap(start - (Math.floor(FOCAL / (j + 1)) >> 1)));
});
const lightNum = (light, bias = 0) => {
  const n = (light >> 4) + bias;
  return n < 0 ? 0 : n >= LIGHTLEVELS ? LIGHTLEVELS - 1 : n;
};

/** 경계 y(실수) → 그 아래가 시작되는 행 번호 [0, H] */
const bound = (y) => {
  const r = Math.ceil(y - 0.5);
  return r < 0 ? 0 : r > H ? H : r;
};

export class Renderer {
  /** @param {{palette: {lit: Uint32Array[]}, textures: import('../gfx/textures.js').TextureStore}} gfx */
  constructor(gfx) {
    this.lit = gfx.palette.lit;
    this.textures = gfx.textures;
    this.pixels = new Uint32Array(W * H);
    this.ceilClip = new Int16Array(W);   // 각 열에서 아직 안 그려진 첫 행
    this.floorClip = new Int16Array(W);  // 각 열에서 아직 안 그려진 마지막 행 + 1
    this.skyCols = new Int16Array(W);    // 열마다 하늘 텍스처의 열 번호
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

    // 하늘 텍스처: 에피소드별 (E1M1 → SKY1). 360° 가 1024열이고 텍스처 폭(256)으로 반복된다
    const ep = /^E(\d)M\d$/.exec(level.name);
    this.sky = this.textures.texture(`SKY${ep ? ep[1] : 1}`) ?? this.textures.texture('SKY1');
    if (this.sky) {
      const sw = this.sky.width;
      for (let x = 0; x < W; x++) {
        const ang = view.angle - Math.atan((x + 0.5 - HALF_W) / FOCAL);
        this.skyCols[x] = (((Math.floor((ang / (2 * Math.PI)) * 1024) % sw) + sw) % sw);
      }
    }

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

  /** sidedef 의 상/중/하 텍스처를 한 번만 찾아 캐시 */
  sideTextures(side) {
    return side.tex || (side.tex = {
      upper: this.textures.texture(side.upperTex),
      mid: this.textures.texture(side.midTex),
      lower: this.textures.texture(side.lowerTex),
    });
  }

  // ---------- seg ----------
  drawSeg(seg) {
    const { px, py, cos, sin, eyeZ, ceilClip, floorClip } = this;
    const ax = seg.v1.x, ay = seg.v1.y, bx = seg.v2.x, by = seg.v2.y;

    // 앞면은 seg 진행 방향의 오른쪽. 시점이 뒤쪽(또는 선 위)이면 건너뜀
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0) return;

    // 시점 공간: z = 앞(깊이), x = 오른쪽
    let dx = ax - px, dy = ay - py;
    let z1 = dx * cos + dy * sin, x1 = dx * sin - dy * cos;
    dx = bx - px; dy = by - py;
    let z2 = dx * cos + dy * sin, x2 = dx * sin - dy * cos;

    // 근평면 클리핑 (텍스처 좌표용으로 seg 상의 비율 tA..tB 도 추적)
    let tA = 0, tB = 1;
    if (z1 < NEAR && z2 < NEAR) return;
    if (z1 < NEAR) { const t = (NEAR - z1) / (z2 - z1); x1 += (x2 - x1) * t; z1 = NEAR; tA = t; }
    else if (z2 < NEAR) { const t = (NEAR - z2) / (z1 - z2); x2 += (x1 - x2) * t; z2 = NEAR; tB = 1 - t; }

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
    let bCeil = 0, bFloor = 0, closed = !back;
    if (back) {
      bCeil = back.ceilingHeight; bFloor = back.floorHeight;
      if (bCeil <= fFloor || bFloor >= fCeil) closed = true;              // 닫힌 문
      if (front.ceilingTex === SKY_FLAT && back.ceilingTex === SKY_FLAT) bCeil = fCeil; // 하늘끼리는 상단 벽 없음
    }
    const side = seg.frontSide, flags = seg.linedef.flags;
    const tex = this.sideTextures(side);
    const yOff = side.yOffset;

    // 텍스처 세로 기준점 H0 = 텍스처 맨 윗줄이 놓이는 월드 높이 (원작 pegging 규칙)
    const midTex = tex.mid ?? this.textures.missingTex;
    const midH0 = (flags & LINE_FLAGS.LOWER_UNPEGGED ? fFloor + midTex.height : fCeil) + yOff;
    const upperTex = back && bCeil < fCeil ? tex.upper : null;
    const upperH0 = upperTex
      ? (flags & LINE_FLAGS.UPPER_UNPEGGED ? fCeil : bCeil + upperTex.height) + yOff : 0;
    const lowerTex = back && bFloor > fFloor ? tex.lower : null;
    const lowerH0 = (flags & LINE_FLAGS.LOWER_UNPEGGED ? fCeil : bFloor) + yOff;

    // 텍스처 가로 좌표 u: u/z 와 1/z 가 화면 x에 선형이므로 둘을 보간해 나눈다
    const segLen = Math.hypot(bx - ax, by - ay);
    const uBase = seg.offset + side.xOffset;
    const uz1 = (uBase + tA * segLen) * inv1, uz2 = (uBase + tB * segLen) * inv2;

    // 조명 (방향별 명암 대비: 가로 벽 -1, 세로 벽 +1)
    const wallLights = scaleLight[lightNum(front.light, ay === by ? -1 : ax === bx ? 1 : 0)];
    const planeLn = lightNum(front.light);
    const floorFlat = front.floorFlat || (front.floorFlat = this.textures.flat(front.floorTex));
    const ceilFlat = front.ceilFlat || (front.ceilFlat = this.textures.flat(front.ceilingTex));
    const skyCeil = front.ceilingTex === SKY_FLAT;

    const span = sx2 - sx1, dInv = inv2 - inv1, dUz = uz2 - uz1;
    for (let x = xs; x <= xe; x++) {
      const top = ceilClip[x], bot = floorClip[x];
      if (top >= bot) continue;

      const s = (x + 0.5 - sx1) / span;
      const invz = inv1 + s * dInv;
      const scale = FOCAL * invz;
      const yCF = bound(HALF_H - (fCeil - eyeZ) * scale);
      const yFF = bound(HALF_H - (fFloor - eyeZ) * scale);
      const u = (uz1 + s * dUz) / invz;
      const level = wallLights[Math.min(MAXLIGHTSCALE - 1, (scale * 16) | 0)];

      // 천장
      this.plane(x, top, Math.min(yCF, bot), fCeil, ceilFlat, planeLn, skyCeil);

      let newTop, newBot;
      if (!back) {
        this.wallCol(x, Math.max(yCF, top), Math.min(yFF, bot), midTex, u, midH0, scale, level);
        newTop = H; newBot = 0;
      } else {
        const yCB = bound(HALF_H - (bCeil - eyeZ) * scale);
        const yFB = bound(HALF_H - (bFloor - eyeZ) * scale);
        if (upperTex) this.wallCol(x, Math.max(yCF, top), Math.min(yCB, yFF, bot), upperTex, u, upperH0, scale, level);
        if (lowerTex) this.wallCol(x, Math.max(yFB, yCF, top), Math.min(yFF, bot), lowerTex, u, lowerH0, scale, level);
        if (closed) { newTop = H; newBot = 0; }
        else { newTop = Math.max(top, yCF, yCB); newBot = Math.min(bot, yFF, yFB); }
      }

      // 바닥
      this.plane(x, Math.max(yFF, top), bot, fFloor, floorFlat, planeLn, false);

      ceilClip[x] = newTop; floorClip[x] = newBot;
      if (newTop >= newBot) this.openCols--;
    }
  }

  /** 한 열에서 벽 [y0, y1) 행을 텍스처로 채움. H0: 텍스처 맨 윗줄의 월드 높이 */
  wallCol(x, y0, y1, tex, u, H0, scale, level) {
    if (y0 >= y1) return;
    const th = tex.height, tw = tex.width;
    const base = (((Math.floor(u) % tw) + tw) % tw) * th;
    const data = tex.data, lit = this.lit[level], pixels = this.pixels;
    const dv = 1 / scale;
    let v = H0 - this.eyeZ + (y0 + 0.5 - HALF_H) * dv; // y0 행 중심이 가리키는 텍스처 행(실수)
    for (let y = y0; y < y1; y++, v += dv) {
      let r = Math.floor(v) % th;
      if (r < 0) r += th;
      pixels[y * W + x] = lit[data[base + r]];
    }
  }

  /** 한 열에서 바닥/천장 [y0, y1) 행을 채움: 행마다 시선 거리를 구해 월드 좌표 → flat 픽셀 */
  plane(x, y0, y1, planeH, flat, lightn, sky) {
    if (y0 >= y1) return;
    const { pixels, lit } = this;
    if (sky) {
      const st = this.sky;
      if (!st) return;
      const base = this.skyCols[x] * st.height, l0 = lit[0], last = st.height - 1;
      for (let y = y0; y < y1; y++) pixels[y * W + x] = l0[st.data[base + (y < last ? y : last)]];
      return;
    }
    const k = Math.abs(planeH - this.eyeZ) * FOCAL;
    const lat = (x + 0.5 - HALF_W) / FOCAL;
    const dirX = this.cos + lat * this.sin, dirY = this.sin - lat * this.cos; // 이 열의 시선 방향 (z 1당 이동량)
    const zl = zLight[lightn];
    const { px, py } = this;
    for (let y = y0; y < y1; y++) {
      const dy = Math.abs(y + 0.5 - HALF_H);
      const z = k / (dy < 0.5 ? 0.5 : dy);                 // 시점 공간 깊이
      const tx = Math.floor(px + z * dirX) & 63;
      const ty = Math.floor(-(py + z * dirY)) & 63;        // flat 의 y 는 월드 y 와 반대 방향
      const j = (z * 0.0625) | 0;
      pixels[y * W + x] = lit[zl[j < MAXLIGHTZ ? j : MAXLIGHTZ - 1]][flat[(ty << 6) | tx]];
    }
  }
}

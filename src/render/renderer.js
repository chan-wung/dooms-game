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
export const SCREEN_H = 200;   // 화면 전체 (3D 뷰 + 하단 상태바)
export const VIEW_H = 168;     // 3D 뷰 높이 (아래 32줄은 상태바)
const SW = SCREEN_W;           // 화면 버퍼의 한 줄 길이
// 지금 그리는 3D 뷰 창 (화면 크기 옵션에 따라 render() 때마다 바뀐다). 뷰 안의 좌표 (x, y) 는 화면 버퍼의 OFF + y * SW + x 에 놓인다.
let W = SW, H = VIEW_H, OFF = 0;
let HALF_W = W / 2, HALF_H = H / 2;
let FOCAL = HALF_W;   // 90° FOV
let SKY_SCALE = 1;    // 하늘 그림은 창이 좁아질수록 세로로도 늘어난다 (원작 pspriteiscale)
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

/** 손에 든 무기의 밝기: 섹터 조명 기준 가장 밝은 거리 구간 (원작 spritelights[MAXLIGHTSCALE-1]) */
export const pspriteColormap = (light, extra = 0) => scaleLight[lightNum(light, extra)][MAXLIGHTSCALE - 1];

/** 화면 크기 옵션(3~11) → 3D 뷰 창 (원작 R_SetViewSize). 10 = 상태바 위 전체, 11 = 상태바 없이 전체 화면 */
export const viewWindow = (blocks) => {
  blocks = Math.max(3, Math.min(11, blocks | 0));
  if (blocks >= 10) return { blocks, x: 0, y: 0, w: SW, h: blocks === 11 ? SCREEN_H : VIEW_H };
  const w = blocks * 32, h = Math.floor((blocks * VIEW_H) / 10) & ~7;
  return { blocks, x: (SW - w) >> 1, y: (VIEW_H - h) >> 1, w, h };
};

/** 경계 y(실수) → 그 아래가 시작되는 행 번호 [0, H] */
const bound = (y) => {
  const r = Math.ceil(y - 0.5);
  return r < 0 ? 0 : r > H ? H : r;
};

export class Renderer {
  /** @param {{palette: {lit: Uint32Array[]}, textures: import('../gfx/textures.js').TextureStore}} gfx */
  constructor(gfx, frame = null) {
    this.palette = gfx.palette;
    this.lit = gfx.palette.lit;
    this.textures = gfx.textures;
    this.sprites = gfx.sprites;
    this.pixels = frame ?? new Uint32Array(SW * SCREEN_H); // 화면 버퍼: 3D 뷰는 window 가 가리키는 사각형
    this.window = viewWindow(10);
    this.depth = new Float32Array(SW * SCREEN_H); // 픽셀별 시점 깊이 (스프라이트/투명 벽의 가림 판정용): 뷰 안 좌표 y * W + x
    this.ceilClip = new Int16Array(SW);   // 각 열에서 아직 안 그려진 첫 행
    this.floorClip = new Int16Array(SW);  // 각 열에서 아직 안 그려진 마지막 행 + 1
    this.skyCols = new Int16Array(SW);    // 열마다 하늘 텍스처의 열 번호
    this.masked = [];                    // 이번 프레임의 투명 중간 텍스처 벽
    this.fixed = -1;                     // 고정 컬러맵 (-1 = 거리/섹터 조명, 32 = 무적, 1 = 빛 증폭)
    this.openCols = W;
    this.segsDrawn = 0;
    this.spritesDrawn = 0;
  }

  /**
   * @param level loadLevel() 결과
   * @param view  { x, y, angle(라디안, 반시계 +), z(눈높이), colormap? }
   * @param mobjs 그릴 thing 목록 (스프라이트)
   */
  /** 화면 색조 (PLAYPAL 번호: 피격 빨강, 아이템 금색 …) */
  setPalette(n) { this.lit = this.palette.litFor(n); }

  /** 3D 뷰 크기 (화면 크기 옵션 3~11) */
  setViewSize(blocks) { this.window = viewWindow(blocks); }

  render(level, view, mobjs = []) {
    const win = this.window;
    W = win.w; H = win.h; OFF = win.y * SW + win.x;
    HALF_W = W / 2; HALF_H = H / 2; FOCAL = HALF_W; SKY_SCALE = SW / W;
    this.level = level;
    this.px = view.x; this.py = view.y; this.eyeZ = view.z;
    this.cos = Math.cos(view.angle); this.sin = Math.sin(view.angle);
    this.fixed = view.colormap ?? -1;
    this.extra = view.extraLight ?? 0;   // 총구 화염 등으로 잠깐 밝아지는 정도 (0~2)

    // 하늘 텍스처: 에피소드별 (E1M1 → SKY1), 둠2 는 MAP01~11 SKY1 · 12~20 SKY2 · 21~ SKY3. 360° 가 1024열이고 텍스처 폭(256)으로 반복된다
    const ep = /^E(\d)M\d$/.exec(level.name), d2 = /^MAP(\d\d)$/.exec(level.name);
    const skyNum = ep ? ep[1] : d2 ? (Number(d2[1]) < 12 ? 1 : Number(d2[1]) < 21 ? 2 : 3) : 1;
    this.sky = this.textures.texture(`SKY${skyNum}`) ?? this.textures.texture('SKY1');
    if (this.sky) {
      const sw = this.sky.width;
      for (let x = 0; x < W; x++) {
        const ang = view.angle - Math.atan((x + 0.5 - HALF_W) / FOCAL);
        this.skyCols[x] = (((Math.floor((ang / (2 * Math.PI)) * 1024) % sw) + sw) % sw);
      }
    }

    this.pixels.fill(0xff000000);
    this.depth.fill(1e9);
    this.ceilClip.fill(0);
    this.floorClip.fill(H);
    this.masked.length = 0;
    this.openCols = W;
    this.segsDrawn = 0;
    this.spritesDrawn = 0;

    this.walk(level.nodes.length ? level.nodes.length - 1 : NF_SUBSECTOR);
    this.drawMasked(mobjs);
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
    seg.linedef.mapped = true;                          // 본 선: 오토맵에 나타난다

    // 앞/뒤 섹터와 벽 종류 결정
    const front = seg.frontSector, back = seg.backSector;
    const fCeil = front.ceilingHeight, fFloor = front.floorHeight;
    let bCeil = 0, bFloor = 0, closed = !back, rawBCeil = 0;
    if (back) {
      bCeil = rawBCeil = back.ceilingHeight; bFloor = back.floorHeight;
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
    const wallLights = scaleLight[lightNum(front.light, (ay === by ? -1 : ax === bx ? 1 : 0) + this.extra)];
    const planeLn = lightNum(front.light, this.extra);
    const floorFlat = front.floorFlat || (front.floorFlat = this.textures.flat(front.floorTex));
    const ceilFlat = front.ceilFlat || (front.ceilFlat = this.textures.flat(front.ceilingTex));
    const skyCeil = front.ceilingTex === SKY_FLAT;

    const span = sx2 - sx1, dInv = inv2 - inv1, dUz = uz2 - uz1;

    // 양면선의 중간 텍스처(창살·격자 등 투명 텍스처): 나중에 스프라이트와 함께 먼 것부터 그린다
    if (back && tex.mid && side.midTex !== '-') {
      const mt = tex.mid, openTop = Math.min(fCeil, rawBCeil), openBottom = Math.max(fFloor, bFloor);
      this.masked.push({
        kind: 1, depth: (z1 + z2) / 2, xs, xe, sx1, span, inv1, dInv, uz1, dUz, tex: mt, openTop, openBottom,
        topW: (flags & LINE_FLAGS.LOWER_UNPEGGED ? openBottom + mt.height : openTop) + yOff, wallLights,
      });
    }

    for (let x = xs; x <= xe; x++) {
      const top = ceilClip[x], bot = floorClip[x];
      if (top >= bot) continue;

      const s = (x + 0.5 - sx1) / span;
      const invz = inv1 + s * dInv;
      const scale = FOCAL * invz;
      const yCF = bound(HALF_H - (fCeil - eyeZ) * scale);
      const yFF = bound(HALF_H - (fFloor - eyeZ) * scale);
      const u = (uz1 + s * dUz) / invz;
      const z = 1 / invz;
      const level = this.fixed >= 0 ? this.fixed : wallLights[Math.min(MAXLIGHTSCALE - 1, (scale * 16) | 0)];

      // 천장
      this.plane(x, top, Math.min(yCF, bot), fCeil, ceilFlat, planeLn, skyCeil);

      let newTop, newBot;
      if (!back) {
        this.wallCol(x, Math.max(yCF, top), Math.min(yFF, bot), midTex, u, midH0, scale, level, z);
        newTop = H; newBot = 0;
      } else {
        const yCB = bound(HALF_H - (bCeil - eyeZ) * scale);
        const yFB = bound(HALF_H - (bFloor - eyeZ) * scale);
        if (upperTex) this.wallCol(x, Math.max(yCF, top), Math.min(yCB, yFF, bot), upperTex, u, upperH0, scale, level, z);
        if (lowerTex) this.wallCol(x, Math.max(yFB, yCF, top), Math.min(yFF, bot), lowerTex, u, lowerH0, scale, level, z);
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
  wallCol(x, y0, y1, tex, u, H0, scale, level, z) {
    if (y0 >= y1) return;
    const th = tex.height, tw = tex.width;
    const base = (((Math.floor(u) % tw) + tw) % tw) * th;
    const data = tex.data, lit = this.lit[level], pixels = this.pixels, depth = this.depth;
    const dv = 1 / scale;
    let v = H0 - this.eyeZ + (y0 + 0.5 - HALF_H) * dv; // y0 행 중심이 가리키는 텍스처 행(실수)
    for (let y = y0; y < y1; y++, v += dv) {
      let r = Math.floor(v) % th;
      if (r < 0) r += th;
      pixels[OFF + y * SW + x] = lit[data[base + r]];
      depth[y * W + x] = z;
    }
  }

  /** 한 열에서 바닥/천장 [y0, y1) 행을 채움: 행마다 시선 거리를 구해 월드 좌표 → flat 픽셀 */
  plane(x, y0, y1, planeH, flat, lightn, sky) {
    if (y0 >= y1) return;
    const { pixels, lit, depth } = this;
    if (sky) {
      const st = this.sky;
      if (!st) return;
      const base = this.skyCols[x] * st.height, l0 = lit[this.fixed >= 0 ? this.fixed : 0], last = st.height - 1;
      for (let y = y0; y < y1; y++) {
        const row = Math.floor(100 + (y - HALF_H) * SKY_SCALE);   // 원작: 하늘은 뷰 중앙이 그림의 100번째 줄
        pixels[OFF + y * SW + x] = l0[st.data[base + (row < 0 ? 0 : row < last ? row : last)]];
      }
      return;
    }
    const k = Math.abs(planeH - this.eyeZ) * FOCAL;
    const lat = (x + 0.5 - HALF_W) / FOCAL;
    const dirX = this.cos + lat * this.sin, dirY = this.sin - lat * this.cos; // 이 열의 시선 방향 (z 1당 이동량)
    const zl = zLight[lightn], fixed = this.fixed;
    const { px, py } = this;
    for (let y = y0; y < y1; y++) {
      const dy = Math.abs(y + 0.5 - HALF_H);
      const z = k / (dy < 0.5 ? 0.5 : dy);                 // 시점 공간 깊이
      const tx = Math.floor(px + z * dirX) & 63;
      const ty = Math.floor(-(py + z * dirY)) & 63;        // flat 의 y 는 월드 y 와 반대 방향
      const j = (z * 0.0625) | 0;
      pixels[OFF + y * SW + x] = lit[fixed >= 0 ? fixed : zl[j < MAXLIGHTZ ? j : MAXLIGHTZ - 1]][flat[(ty << 6) | tx]];
      depth[y * W + x] = z;
    }
  }

  // ---------- 스프라이트 + 투명 벽 ----------
  /** thing 을 화면에 투영해 그릴 목록으로 만든다 (너무 가깝거나 화면 밖이면 제외) */
  projectSprites(mobjs, out) {
    const { px, py, cos, sin } = this;
    for (const m of mobjs) {
      if (m.removed || m.hidden) continue;
      const frame = this.sprites.frame(m.sprite, m.frame);
      if (!frame) continue;
      const dx = m.x - px, dy = m.y - py;
      const tz = dx * cos + dy * sin;
      if (tz < 4) continue;
      const tx = dx * sin - dy * cos;

      // 보는 각도에 따른 회전 그림 선택: 정면(1번)은 thing 이 보는 사람을 향할 때
      let ent = frame.rot[0];
      if (frame.rotates) {
        const diff = Math.atan2(dy, dx) - m.angle;
        const rot = Math.floor((diff * 4) / Math.PI + 4.5);
        ent = frame.rot[((rot % 8) + 8) % 8];
      }
      const tex = this.sprites.tex(ent.lump);
      const scale = FOCAL / tz;
      const xl = HALF_W + (tx - tex.leftOffset) * scale;
      if (xl + tex.width * scale <= 0 || xl >= W) continue;

      // 밝기: 풀브라이트는 최대 밝기, 아니면 섹터 조명 + 거리
      let cmap = 0;
      if (!m.bright) {
        cmap = this.fixed >= 0 ? this.fixed
          : scaleLight[lightNum(m.sector.light, this.extra)][Math.min(MAXLIGHTSCALE - 1, (scale * 16) | 0)];
      }
      out.push({ kind: 0, depth: tz, tex, flip: ent.flip, scale, xl, z: m.z, cmap, fuzz: m.fuzz });
    }
  }

  drawMasked(mobjs) {
    const list = this.masked;                    // 투명 벽(kind 1)에 스프라이트(kind 0)를 추가
    this.projectSprites(mobjs, list);
    list.sort((a, b) => b.depth - a.depth);      // 먼 것부터 (화가 알고리즘 + 픽셀 깊이 검사)
    for (const e of list) {
      if (e.kind === 0) this.drawSprite(e); else this.drawMaskedSeg(e);
    }
  }

  drawSprite(s) {
    const { tex, scale, xl, flip } = s;
    const w = tex.width, h = tex.height, data = tex.data, mask = tex.mask;
    const { pixels, depth } = this;
    const table = this.lit[s.cmap];
    const x0 = Math.max(0, Math.ceil(xl - 0.5)), x1 = Math.min(W - 1, Math.ceil(xl + w * scale - 0.5) - 1);
    const yt = HALF_H - (s.z + tex.topOffset - this.eyeZ) * scale;   // 스프라이트 맨 윗줄의 화면 y
    const y0 = bound(yt), y1 = bound(yt + h * scale);
    const inv = 1 / scale;
    this.spritesDrawn++;

    for (let x = x0; x <= x1; x++) {
      let tc = Math.floor((x + 0.5 - xl) * inv);
      tc = tc < 0 ? 0 : tc >= w ? w - 1 : tc;
      if (flip) tc = w - 1 - tc;
      const base = tc * h;
      for (let y = y0; y < y1; y++) {
        let r = Math.floor((y + 0.5 - yt) * inv);
        r = r < 0 ? 0 : r >= h ? h - 1 : r;
        if (!mask[base + r]) continue;
        if (s.depth > depth[y * W + x] + 1) continue;     // 더 가까운 벽/바닥에 가려짐
        const pi = OFF + y * SW + x;
        if (s.fuzz) {                             // 부분 투명(스펙터): 주변 화면을 어둡게
          const src = pixels[(y > 0 && ((x + y) & 1) ? pi - SW : pi)];
          pixels[pi] = 0xff000000 | ((((src >> 16) & 255) * 0.55) << 16) | ((((src >> 8) & 255) * 0.55) << 8) | ((src & 255) * 0.55);
        } else {
          pixels[pi] = table[data[base + r]];
        }
      }
    }
  }

  /** 양면선의 중간 텍스처: 한 번만(세로 반복 없이) 그리고 투명 픽셀은 건너뜀 */
  drawMaskedSeg(e) {
    const { tex, openTop, openBottom, topW } = e;
    const th = tex.height, tw = tex.width, data = tex.data, mask = tex.mask;
    const { pixels, depth, eyeZ } = this;
    for (let x = e.xs; x <= e.xe; x++) {
      const s = (x + 0.5 - e.sx1) / e.span;
      const invz = e.inv1 + s * e.dInv;
      const z = 1 / invz, scale = FOCAL * invz;
      const u = (e.uz1 + s * e.dUz) / invz;
      const base = (((Math.floor(u) % tw) + tw) % tw) * th;
      const lit = this.lit[this.fixed >= 0 ? this.fixed : e.wallLights[Math.min(MAXLIGHTSCALE - 1, (scale * 16) | 0)]];

      const yt = HALF_H - (topW - eyeZ) * scale;                     // 텍스처 맨 윗줄
      const yTop = bound(HALF_H - (Math.min(topW, openTop) - eyeZ) * scale);
      const yBot = bound(HALF_H - (Math.max(topW - th, openBottom) - eyeZ) * scale);
      const inv = 1 / scale;
      for (let y = yTop; y < yBot; y++) {
        const r = Math.floor((y + 0.5 - yt) * inv);
        if (r < 0 || r >= th || !mask[base + r]) continue;
        if (z > depth[y * W + x] + 1) continue;
        pixels[OFF + y * SW + x] = lit[data[base + r]];
      }
    }
  }
}

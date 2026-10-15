import { decodePatch } from './patch.js';

const readName = (bytes, off) => {
  let s = '';
  for (let i = 0; i < 8 && bytes[off + i]; i++) s += String.fromCharCode(bytes[off + i]);
  return s.toUpperCase();
};

/**
 * 원작 animdefs (p_spec.c): [벽이면 true, 끝 이름, 시작 이름]. 시작~끝 사이의 모든 텍스처가 한 묶음이고 8tic 마다 한 칸씩 돈다.
 * 묶음의 순서는 벽은 TEXTURE 목록, 바닥은 F_START~F_END 순서. 이 WAD 에 없는 묶음(정식판·DOOM II 것)은 건너뛴다.
 */
const ANIM_SPEED = 8;
const ANIMDEFS = [
  [false, 'NUKAGE3', 'NUKAGE1'], [false, 'FWATER4', 'FWATER1'], [false, 'SWATER4', 'SWATER1'], [false, 'LAVA4', 'LAVA1'], [false, 'BLOOD3', 'BLOOD1'],
  [false, 'RROCK08', 'RROCK05'], [false, 'SLIME04', 'SLIME01'], [false, 'SLIME08', 'SLIME05'], [false, 'SLIME12', 'SLIME09'],
  [true, 'BLODGR4', 'BLODGR1'], [true, 'SLADRIP3', 'SLADRIP1'], [true, 'BLODRIP4', 'BLODRIP1'], [true, 'FIREWALL', 'FIREWALA'],
  [true, 'GSTFONT3', 'GSTFONT1'], [true, 'FIRELAVA', 'FIRELAV3'], [true, 'FIREMAG3', 'FIREMAG1'], [true, 'FIREBLU2', 'FIREBLU1'],
  [true, 'ROCKRED3', 'ROCKRED1'], [true, 'BFALL4', 'BFALL1'], [true, 'SFALL4', 'SFALL1'], [true, 'WFALL4', 'WFALL1'], [true, 'DBRAIN4', 'DBRAIN1'],
];

/**
 * 벽 텍스처(PNAMES + TEXTURE1/2 로 패치를 합성)와 바닥/천장 flat(64×64) 저장소.
 * 텍스처 데이터는 열 우선(column-major): data[x * height + y] = 팔레트 인덱스.
 * 필요할 때 합성하고 캐시한다.
 */
export class TextureStore {
  constructor(wad) {
    this.wad = wad;
    this.defs = new Map();       // 이름 → 텍스처 정의
    this.cache = new Map();      // 이름 → 합성 결과
    this.patchCache = new Map(); // PNAMES 번호 → 디코딩된 patch (없으면 null)
    this.flatLumps = new Map();  // flat 이름 → lump 번호
    this.flatCache = new Map();

    this.pnames = this.readPnames();
    for (const lump of ['TEXTURE1', 'TEXTURE2']) if (wad.has(lump)) this.readTextureLump(lump);

    const fs = wad.indexOf('F_START'), fe = wad.indexOf('F_END');
    if (fs >= 0 && fe > fs) {
      for (let i = fs + 1; i < fe; i++) if (wad.lumps[i].size === 4096) this.flatLumps.set(wad.lumps[i].name, i);
    }

    this.missingTex = this.makeMissing(64, 64);
    this.missingFlat = new Uint8Array(4096).fill(0xb0);
    this.setupAnimations();
  }

  /**
   * 애니메이션 묶음 만들기. 묶음에 속한 이름은 늘 같은 "대리 객체"를 돌려주고, animate() 가 그 내용만 바꿔 끼운다.
   * 그래서 렌더러가 sidedef/섹터에 캐시해 둔 텍스처 객체는 그대로 두고도 움직임이 반영된다.
   */
  setupAnimations() {
    this.anims = [];
    this.texProxy = new Map();    // 벽 이름 → 대리 텍스처 객체
    this.flatProxy = new Map();   // 바닥 이름 → 대리 flat (Uint8Array 4096)
    const texNames = [...this.defs.keys()], flatNames = [...this.flatLumps.keys()];
    for (const [isTexture, end, start] of ANIMDEFS) {
      const names = isTexture ? texNames : flatNames;
      const a = names.indexOf(start), b = names.indexOf(end);
      if (a < 0 || b <= a) continue;
      const frames = names.slice(a, b + 1);
      const proxies = frames.map((name) => (isTexture ? { ...this.compose(name, this.defs.get(name)) } : this.wad.getLump(this.flatLumps.get(name)).slice()));
      frames.forEach((name, i) => (isTexture ? this.texProxy : this.flatProxy).set(name, proxies[i]));
      this.anims.push({ isTexture, frames, proxies, shift: 0 });
    }
  }

  /** 게임 시간(tic)에 맞춰 묶음마다 다음 프레임으로 (원작: 시작 + (i + 시간/8) % 장수) */
  animate(time) {
    const shift = Math.floor(time / ANIM_SPEED);
    for (const a of this.anims) {
      if (a.shift === shift) continue;
      a.shift = shift;
      const n = a.frames.length;
      a.frames.forEach((_, i) => {
        const src = a.frames[(i + shift) % n];
        if (a.isTexture) {
          const t = this.baseTexture(src);
          Object.assign(a.proxies[i], { data: t.data, mask: t.mask, width: t.width, height: t.height });
        } else {
          a.proxies[i].set(this.baseFlat(src));
        }
      });
    }
  }

  /** 애니메이션과 상관없는 원래 텍스처/flat (프레임의 그림 자체) */
  baseTexture(name) {
    let t = this.baseCache?.get(name);
    if (!t) { (this.baseCache ||= new Map()).set(name, (t = this.compose(name, this.defs.get(name)))); }
    return t;
  }

  baseFlat(name) { return this.wad.getLump(this.flatLumps.get(name)); }

  readPnames() {
    const b = this.wad.getLump('PNAMES');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = dv.getInt32(0, true);
    return Array.from({ length: n }, (_, i) => readName(b, 4 + i * 8));
  }

  readTextureLump(lumpName) {
    const b = this.wad.getLump(lumpName);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const num = dv.getInt32(0, true);
    for (let i = 0; i < num; i++) {
      const o = dv.getInt32(4 + i * 4, true);
      const patchCount = dv.getInt16(o + 20, true);
      const patches = [];
      for (let j = 0; j < patchCount; j++) {
        const p = o + 22 + j * 10;
        patches.push({ x: dv.getInt16(p, true), y: dv.getInt16(p + 2, true), index: dv.getInt16(p + 4, true) });
      }
      this.defs.set(readName(b, o), { width: dv.getInt16(o + 12, true), height: dv.getInt16(o + 14, true), patches });
    }
  }

  getPatch(index) {
    if (this.patchCache.has(index)) return this.patchCache.get(index);
    let patch = null;
    const lump = this.wad.indexOf(this.pnames[index] ?? '');
    if (lump >= 0) {
      try { patch = decodePatch(this.wad.getLump(lump)); } catch { patch = null; }
    }
    this.patchCache.set(index, patch);
    return patch;
  }

  /** 못 찾은 텍스처용 체커보드 */
  makeMissing(w, h) {
    const data = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) data[x * h + y] = ((x >> 3) + (y >> 3)) & 1 ? 0xb0 : 0x60;
    return { name: '?', width: w, height: h, data, mask: new Uint8Array(w * h).fill(1) };
  }

  /** '-'(없음)이면 null, 정의가 없으면 체커보드 */
  texture(name) {
    if (!name || name === '-') return null;
    const proxy = this.texProxy.get(name);
    if (proxy) return proxy;
    let tex = this.cache.get(name);
    if (tex) return tex;
    const def = this.defs.get(name);
    if (!def) { console.warn('텍스처 없음:', name); tex = this.missingTex; }
    else tex = this.compose(name, def);
    this.cache.set(name, tex);
    return tex;
  }

  compose(name, def) {
    const { width: w, height: h } = def;
    const data = new Uint8Array(w * h); // 패치가 안 덮은 부분은 0
    const mask = new Uint8Array(w * h); // 1 = 그려진 픽셀 (양면선 중간 텍스처의 투명 부분 판정용)
    for (const pp of def.patches) {
      const patch = this.getPatch(pp.index);
      if (!patch) continue;
      for (let px = 0; px < patch.width; px++) {
        const x = pp.x + px;
        if (x < 0 || x >= w) continue;
        for (const post of patch.columns[px]) {
          for (let i = 0; i < post.length; i++) {
            const y = pp.y + post.top + i;
            if (y >= 0 && y < h) { data[x * h + y] = patch.bytes[post.start + i]; mask[x * h + y] = 1; }
          }
        }
      }
    }
    return { name, width: w, height: h, data, mask };
  }

  /** 64×64 flat (행 우선: data[y * 64 + x]) */
  flat(name) {
    const proxy = this.flatProxy.get(name);
    if (proxy) return proxy;
    let f = this.flatCache.get(name);
    if (f) return f;
    const i = this.flatLumps.get(name);
    if (i === undefined) { console.warn('flat 없음:', name); f = this.missingFlat; }
    else f = this.wad.getLump(i);
    this.flatCache.set(name, f);
    return f;
  }
}

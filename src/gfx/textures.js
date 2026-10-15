import { decodePatch } from './patch.js';

const readName = (bytes, off) => {
  let s = '';
  for (let i = 0; i < 8 && bytes[off + i]; i++) s += String.fromCharCode(bytes[off + i]);
  return s.toUpperCase();
};

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
  }

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
    return { name: '?', width: w, height: h, data };
  }

  /** '-'(없음)이면 null, 정의가 없으면 체커보드 */
  texture(name) {
    if (!name || name === '-') return null;
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
    for (const pp of def.patches) {
      const patch = this.getPatch(pp.index);
      if (!patch) continue;
      for (let px = 0; px < patch.width; px++) {
        const x = pp.x + px;
        if (x < 0 || x >= w) continue;
        for (const post of patch.columns[px]) {
          for (let i = 0; i < post.length; i++) {
            const y = pp.y + post.top + i;
            if (y >= 0 && y < h) data[x * h + y] = patch.bytes[post.start + i];
          }
        }
      }
    }
    return { name, width: w, height: h, data };
  }

  /** 64×64 flat (행 우선: data[y * 64 + x]) */
  flat(name) {
    let f = this.flatCache.get(name);
    if (f) return f;
    const i = this.flatLumps.get(name);
    if (i === undefined) { console.warn('flat 없음:', name); f = this.missingFlat; }
    else f = this.wad.getLump(i);
    this.flatCache.set(name, f);
    return f;
  }
}

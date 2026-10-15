/**
 * WAD 컨테이너 파서: 헤더 → 디렉터리 → lump 조회.
 * 모든 정수는 리틀엔디언.
 */
const readName = (bytes, off) => {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const c = bytes[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.toUpperCase();
};

export class Wad {
  /** @param {ArrayBuffer} buffer */
  constructor(buffer) {
    this.buffer = buffer;
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const id = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (id !== 'IWAD' && id !== 'PWAD') throw new Error(`WAD 헤더가 아님: "${id}"`);
    this.type = id;

    const numLumps = view.getInt32(4, true);
    const dirOffset = view.getInt32(8, true);
    if (dirOffset + numLumps * 16 > buffer.byteLength) throw new Error('WAD 디렉터리가 파일 범위를 벗어남');

    /** @type {{name:string, offset:number, size:number}[]} */
    this.lumps = [];
    this.index = new Map(); // 이름 → 마지막 lump 번호 (PWAD 덮어쓰기 규칙)
    for (let i = 0; i < numLumps; i++) {
      const p = dirOffset + i * 16;
      const lump = {
        offset: view.getInt32(p, true),
        size: view.getInt32(p + 4, true),
        name: readName(bytes, p + 8),
      };
      this.lumps.push(lump);
      this.index.set(lump.name, i);
    }
  }

  has(name) { return this.index.has(name.toUpperCase()); }

  /** lump 번호 (없으면 -1) */
  indexOf(name) {
    const i = this.index.get(name.toUpperCase());
    return i === undefined ? -1 : i;
  }

  /** lump 원본 바이트 (복사 없이 뷰) */
  getLump(nameOrIndex) {
    const i = typeof nameOrIndex === 'number' ? nameOrIndex : this.indexOf(nameOrIndex);
    if (i < 0 || i >= this.lumps.length) throw new Error(`lump 없음: ${nameOrIndex}`);
    const { offset, size } = this.lumps[i];
    return new Uint8Array(this.buffer, offset, size);
  }

  /** start/end 마커 사이의 lump 이름·번호 목록 (마커 제외) */
  getLumpsBetween(start, end) {
    const s = this.indexOf(start), e = this.indexOf(end);
    if (s < 0 || e < 0 || e < s) return [];
    const out = [];
    for (let i = s + 1; i < e; i++) out.push({ index: i, ...this.lumps[i] });
    return out;
  }

  /** E1M1 같은 맵 마커 이름 목록 */
  getMapNames() {
    return this.lumps.map((l) => l.name).filter((n) => /^(E\dM\d|MAP\d\d)$/.test(n));
  }
}

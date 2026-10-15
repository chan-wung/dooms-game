/**
 * BLOCKMAP: 맵을 128×128 칸으로 나눠 칸마다 걸친 선(linedef) 번호를 담은 격자.
 * 헤더(int16): xOrigin, yOrigin, 칸 수(열), 칸 수(행) → 칸별 오프셋(uint16, 단위 = word) → 목록 [0, 선..., 0xFFFF]
 * 목록 맨 앞의 0 은 시작 표시라 건너뛴다.
 */
const CELL = 128;

export class Blockmap {
  constructor(level) {
    const b = level.blockmap;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.xOrigin = dv.getInt16(0, true);
    this.yOrigin = dv.getInt16(2, true);
    this.cols = dv.getInt16(4, true);
    this.rows = dv.getInt16(6, true);
    this.lines = level.linedefs;
    this.stamp = new Int32Array(level.linedefs.length); // 한 번의 질의에서 같은 선을 중복 방문하지 않기 위한 표식
    this.query = 0;

    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) {
      let p = dv.getUint16(8 + i * 2, true);
      const list = [];
      p++; // 시작 표시 0 건너뜀
      for (; p < b.length / 2; p++) {
        const n = dv.getUint16(p * 2, true);
        if (n === 0xffff) break;
        list.push(n);
      }
      this.cells[i] = list;
    }
  }

  /** 사각형과 겹치는 칸에 걸친 모든 선에 대해 fn(linedef) 호출 (선마다 한 번) */
  forEachLine(minX, minY, maxX, maxY, fn) {
    const c0 = Math.max(0, Math.floor((minX - this.xOrigin) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((maxX - this.xOrigin) / CELL));
    const r0 = Math.max(0, Math.floor((minY - this.yOrigin) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((maxY - this.yOrigin) / CELL));
    const q = ++this.query;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells[r * this.cols + c];
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (this.stamp[n] === q) continue;
          this.stamp[n] = q;
          fn(this.lines[n]);
        }
      }
    }
  }
}

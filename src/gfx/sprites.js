import { decodePatch } from './patch.js';

/**
 * 스프라이트 저장소.
 * lump 이름 규칙: 접두 4글자 + 프레임 글자(A..) + 회전 숫자(0..8) [+ 반전용 프레임 글자 + 회전 숫자]
 *   예) TROOA2A8 = 프레임 A 의 회전 2번 그림, 그리고 같은 그림을 좌우 반전해 회전 8번으로 쓴다.
 *   회전 0 = 모든 방향에서 같은 그림. 회전 1 = 정면(보는 사람을 향함), 2.. = 시계 반대 방향으로 45° 씩.
 */
export class SpriteStore {
  constructor(wad) {
    this.wad = wad;
    this.defs = new Map();   // 접두 → 프레임 배열 [{ rotates, rot: [{ lump, flip } × 8] }]
    this.texCache = new Map();

    const s = wad.indexOf('S_START'), e = wad.indexOf('S_END');
    if (s < 0 || e <= s) return;
    for (let i = s + 1; i < e; i++) {
      const name = wad.lumps[i].name;
      if (name.length !== 6 && name.length !== 8) continue;
      const prefix = name.slice(0, 4);
      this.install(prefix, name.charCodeAt(4) - 65, name.charCodeAt(5) - 48, i, false);
      if (name.length === 8) this.install(prefix, name.charCodeAt(6) - 65, name.charCodeAt(7) - 48, i, true);
    }
  }

  install(prefix, frame, rotation, lump, flip) {
    if (frame < 0 || frame > 28 || rotation < 0 || rotation > 8) return;
    let frames = this.defs.get(prefix);
    if (!frames) this.defs.set(prefix, (frames = []));
    const f = frames[frame] || (frames[frame] = { rotates: false, rot: new Array(8).fill(null) });
    if (rotation === 0) {
      f.rotates = false;
      f.rot.fill({ lump, flip });
    } else {
      f.rotates = true;
      f.rot[rotation - 1] = { lump, flip };
    }
  }

  /** 프레임 정의 (없으면 null). 비어 있는 회전은 다른 회전으로 채워 둔다 */
  frame(prefix, index) {
    const f = this.defs.get(prefix)?.[index];
    if (!f) return null;
    if (f.rotates && f.rot.some((r) => !r)) {
      const any = f.rot.find((r) => r);
      for (let i = 0; i < 8; i++) if (!f.rot[i]) f.rot[i] = any;
    }
    return f;
  }

  /** lump → 그릴 수 있는 형태 (열 우선 data + 투명 mask). 처음 쓸 때 만들고 캐시 */
  tex(lump) {
    let t = this.texCache.get(lump);
    if (t) return t;
    const p = decodePatch(this.wad.getLump(lump));
    const data = new Uint8Array(p.width * p.height);
    const mask = new Uint8Array(p.width * p.height);
    for (let x = 0; x < p.width; x++) {
      for (const post of p.columns[x]) {
        for (let i = 0; i < post.length; i++) {
          const y = post.top + i;
          if (y < p.height) { data[x * p.height + y] = p.bytes[post.start + i]; mask[x * p.height + y] = 1; }
        }
      }
    }
    t = { width: p.width, height: p.height, leftOffset: p.leftOffset, topOffset: p.topOffset, data, mask };
    this.texCache.set(lump, t);
    return t;
  }
}

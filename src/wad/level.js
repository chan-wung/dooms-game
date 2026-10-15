/**
 * 레벨(맵) lump 묶음 파서.
 * 맵 마커(E1M1) 뒤에 THINGS, LINEDEFS, SIDEDEFS, VERTEXES, SEGS, SSECTORS, NODES, SECTORS, REJECT, BLOCKMAP 순서로 이어진다.
 * 좌표 단위는 원작과 같은 정수 맵 유닛 (y축은 위쪽이 +).
 */

export const LINE_FLAGS = {
  BLOCKING: 0x0001,
  BLOCK_MONSTERS: 0x0002,
  TWO_SIDED: 0x0004,
  UPPER_UNPEGGED: 0x0008,
  LOWER_UNPEGGED: 0x0010,
  SECRET: 0x0020,
  BLOCK_SOUND: 0x0040,
  NOT_ON_MAP: 0x0080,
  ALWAYS_ON_MAP: 0x0100,
};

const readName = (bytes, off) => {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const c = bytes[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.toUpperCase();
};

const LUMP_ORDER = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];

/** 레코드 크기로 나눠 떨어지는지 확인하며 개수를 돌려준다 */
const count = (lump, size, label) => {
  if (lump.length % size !== 0) throw new Error(`${label} lump 크기(${lump.length})가 ${size}의 배수가 아님`);
  return lump.length / size;
};

/**
 * @param {import('./wad.js').Wad} wad
 * @param {string} mapName 예: 'E1M1'
 */
export function loadLevel(wad, mapName) {
  const marker = wad.indexOf(mapName);
  if (marker < 0) throw new Error(`맵 없음: ${mapName}`);

  const raw = {};
  LUMP_ORDER.forEach((name, i) => {
    const idx = marker + 1 + i;
    if (!wad.lumps[idx] || wad.lumps[idx].name !== name) {
      throw new Error(`${mapName}: ${name} lump 위치가 올바르지 않음 (실제: ${wad.lumps[idx]?.name})`);
    }
    raw[name] = wad.getLump(idx);
  });

  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // VERTEXES (4B): x, y
  let d = dv(raw.VERTEXES);
  const vertexes = Array.from({ length: count(raw.VERTEXES, 4, 'VERTEXES') }, (_, i) => ({
    x: d.getInt16(i * 4, true),
    y: d.getInt16(i * 4 + 2, true),
  }));

  // SECTORS (26B)
  d = dv(raw.SECTORS);
  const sectors = Array.from({ length: count(raw.SECTORS, 26, 'SECTORS') }, (_, i) => {
    const p = i * 26;
    return {
      index: i,
      floorHeight: d.getInt16(p, true),
      ceilingHeight: d.getInt16(p + 2, true),
      floorTex: readName(raw.SECTORS, p + 4),
      ceilingTex: readName(raw.SECTORS, p + 12),
      light: d.getInt16(p + 20, true),
      special: d.getInt16(p + 22, true),
      tag: d.getInt16(p + 24, true),
      lines: [],            // 이 섹터에 접한 선 (아래에서 채움)
      specialData: null,    // 현재 이 섹터를 움직이는 문/리프트 등
    };
  });

  // SIDEDEFS (30B)
  d = dv(raw.SIDEDEFS);
  const sidedefs = Array.from({ length: count(raw.SIDEDEFS, 30, 'SIDEDEFS') }, (_, i) => {
    const p = i * 30;
    const sector = d.getUint16(p + 28, true);
    if (sector >= sectors.length) throw new Error(`SIDEDEF ${i}: 잘못된 sector ${sector}`);
    return {
      xOffset: d.getInt16(p, true),
      yOffset: d.getInt16(p + 2, true),
      upperTex: readName(raw.SIDEDEFS, p + 4),
      lowerTex: readName(raw.SIDEDEFS, p + 12),
      midTex: readName(raw.SIDEDEFS, p + 20),
      sector: sectors[sector],
      sectorIndex: sector,
    };
  });

  // LINEDEFS (14B)
  d = dv(raw.LINEDEFS);
  const side = (n) => (n === 0xffff ? null : sidedefs[n] ?? null);
  const linedefs = Array.from({ length: count(raw.LINEDEFS, 14, 'LINEDEFS') }, (_, i) => {
    const p = i * 14;
    const v1 = d.getUint16(p, true), v2 = d.getUint16(p + 2, true);
    if (v1 >= vertexes.length || v2 >= vertexes.length) throw new Error(`LINEDEF ${i}: 잘못된 vertex`);
    const a = vertexes[v1], b = vertexes[v2];
    const right = side(d.getUint16(p + 10, true)), left = side(d.getUint16(p + 12, true));
    return {
      index: i,
      v1: a,
      v2: b,
      dx: b.x - a.x, dy: b.y - a.y,
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
      flags: d.getUint16(p + 4, true),
      special: d.getUint16(p + 6, true),
      tag: d.getUint16(p + 8, true),
      right,
      left,
      frontSector: right ? right.sector : null,
      backSector: left ? left.sector : null,
    };
  });
  // 섹터별 접한 선 목록 (이웃 섹터 탐색용)
  for (const ld of linedefs) {
    if (ld.frontSector) ld.frontSector.lines.push(ld);
    if (ld.backSector && ld.backSector !== ld.frontSector) ld.backSector.lines.push(ld);
  }

  // THINGS (10B)
  d = dv(raw.THINGS);
  const things = Array.from({ length: count(raw.THINGS, 10, 'THINGS') }, (_, i) => {
    const p = i * 10;
    return {
      x: d.getInt16(p, true),
      y: d.getInt16(p + 2, true),
      angle: d.getInt16(p + 4, true),
      type: d.getInt16(p + 6, true),
      flags: d.getInt16(p + 8, true),
    };
  });

  // SEGS (12B), SSECTORS (4B), NODES (28B) — Phase 2 BSP 렌더링에서 사용
  d = dv(raw.SEGS);
  const segs = Array.from({ length: count(raw.SEGS, 12, 'SEGS') }, (_, i) => {
    const p = i * 12;
    const linedef = linedefs[d.getUint16(p + 6, true)];
    const direction = d.getInt16(p + 8, true);        // 0 = 선과 같은 방향, 1 = 반대
    const frontSide = direction === 0 ? linedef.right : linedef.left;
    const backSide = direction === 0 ? linedef.left : linedef.right;
    return {
      v1: vertexes[d.getUint16(p, true)],
      v2: vertexes[d.getUint16(p + 2, true)],
      angle: d.getInt16(p + 4, true),   // BAM (65536 = 360°)
      linedef,
      direction,
      offset: d.getInt16(p + 10, true),
      frontSide,
      frontSector: frontSide.sector,
      backSector: backSide ? backSide.sector : null,
    };
  });

  d = dv(raw.SSECTORS);
  const subsectors = Array.from({ length: count(raw.SSECTORS, 4, 'SSECTORS') }, (_, i) => {
    const firstSeg = d.getUint16(i * 4 + 2, true);
    return { segCount: d.getUint16(i * 4, true), firstSeg, sector: segs[firstSeg].frontSector };
  });

  d = dv(raw.NODES);
  const nodes = Array.from({ length: count(raw.NODES, 28, 'NODES') }, (_, i) => {
    const p = i * 28;
    const bbox = (o) => ({
      top: d.getInt16(p + o, true), bottom: d.getInt16(p + o + 2, true),
      left: d.getInt16(p + o + 4, true), right: d.getInt16(p + o + 6, true),
    });
    return {
      x: d.getInt16(p, true), y: d.getInt16(p + 2, true),
      dx: d.getInt16(p + 4, true), dy: d.getInt16(p + 6, true),
      bbox: [bbox(8), bbox(16)],                        // [오른쪽, 왼쪽]
      children: [d.getUint16(p + 24, true), d.getUint16(p + 26, true)], // 최상위 비트 = 서브섹터
    };
  });

  // 맵 경계
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertexes) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }

  const start = things.find((t) => t.type === 1) ?? null; // 플레이어 1 시작점

  return {
    name: mapName,
    vertexes, linedefs, sidedefs, sectors, things, segs, subsectors, nodes,
    reject: raw.REJECT, blockmap: raw.BLOCKMAP,
    bounds: { minX, minY, maxX, maxY },
    playerStart: start,
  };
}


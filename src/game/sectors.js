/** 섹터 이웃 탐색 도우미 (문/리프트/바닥/조명이 목표 높이를 정할 때 사용) */

/** 선 너머의 반대편 섹터 (한쪽 벽이면 null) */
export const nextSector = (line, sector) => {
  if (!line.frontSector || !line.backSector) return null;
  return line.frontSector === sector ? line.backSector : line.frontSector;
};

export const lowestFloorSurrounding = (sec) => {
  let h = sec.floorHeight;
  for (const l of sec.lines) { const o = nextSector(l, sec); if (o && o.floorHeight < h) h = o.floorHeight; }
  return h;
};

export const highestFloorSurrounding = (sec) => {
  let h = -500;
  for (const l of sec.lines) { const o = nextSector(l, sec); if (o && o.floorHeight > h) h = o.floorHeight; }
  return h;
};

/** 현재 높이보다 높은 이웃 바닥 중 가장 낮은 것 (없으면 현재 높이) */
export const nextHighestFloor = (sec, current) => {
  let best = Infinity;
  for (const l of sec.lines) {
    const o = nextSector(l, sec);
    if (o && o.floorHeight > current && o.floorHeight < best) best = o.floorHeight;
  }
  return best === Infinity ? current : best;
};

export const lowestCeilingSurrounding = (sec) => {
  let h = 32767;
  for (const l of sec.lines) { const o = nextSector(l, sec); if (o && o.ceilingHeight < h) h = o.ceilingHeight; }
  return h;
};

/** 이웃 중 가장 어두운 조명 (max 이하) */
export const minSurroundingLight = (sec, max) => {
  let m = max;
  for (const l of sec.lines) { const o = nextSector(l, sec); if (o && o.light < m) m = o.light; }
  return m;
};

export const maxSurroundingLight = (sec) => {
  let m = 0;
  for (const l of sec.lines) { const o = nextSector(l, sec); if (o && o.light > m) m = o.light; }
  return m;
};

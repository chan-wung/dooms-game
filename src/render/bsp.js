/** BSP 트리 질의 (렌더러·플레이어 공용) */
export const NF_SUBSECTOR = 0x8000; // 노드 자식 번호의 이 비트가 켜져 있으면 서브섹터

/** 점이 노드 분할선의 어느 쪽인지: 0 = 앞(오른쪽 자식), 1 = 뒤(왼쪽 자식) */
export const pointOnSide = (x, y, node) => {
  const left = node.dy * (x - node.x);
  const right = (y - node.y) * node.dx;
  return right < left ? 0 : 1;
};

/** 점이 속한 서브섹터 번호 */
export const subsectorAt = (level, x, y) => {
  let n = level.nodes.length ? level.nodes.length - 1 : NF_SUBSECTOR;
  while (!(n & NF_SUBSECTOR)) {
    const node = level.nodes[n];
    n = node.children[pointOnSide(x, y, node)];
  }
  return n & ~NF_SUBSECTOR;
};

export const sectorAt = (level, x, y) => level.subsectors[subsectorAt(level, x, y)].sector;

/** 맵 진행 순서 (에피소드 1~3, 비밀 맵 M9) */
const RETURN_FROM_SECRET = { 1: 4, 2: 6, 3: 7 }; // 비밀 맵(M9)에서 나오면 돌아가는 곳

/** 출구 다음 맵 (일반/비밀 출구). null 이면 에피소드 끝 */
export const nextMapName = (name, secret) => {
  const m = /^E(\d)M(\d)$/.exec(name);
  if (!m) return null;
  const e = Number(m[1]), n = Number(m[2]);
  if (secret) return `E${e}M9`;
  if (n === 9) return `E${e}M${RETURN_FROM_SECRET[e]}`;
  if (n === 8) return null;                // 에피소드 마지막
  return `E${e}M${n + 1}`;
};

/** 맵 진행 순서 (둠1: 에피소드 1~4, 비밀 맵 M9 / 둠2: MAP01~30, 비밀 맵 MAP31·32) */
const RETURN_FROM_SECRET = { 1: 4, 2: 6, 3: 7, 4: 3 }; // 비밀 맵(M9)에서 나오면 돌아가는 곳

const mapNum = (n) => `MAP${String(n).padStart(2, '0')}`;

/** 출구 다음 맵 (일반/비밀 출구). null 이면 에피소드(게임) 끝 */
export const nextMapName = (name, secret) => {
  const d2 = /^MAP(\d\d)$/.exec(name);
  if (d2) {
    const n = Number(d2[1]);
    if (secret && n === 15) return mapNum(31);
    if (secret && n === 31) return mapNum(32);
    if (n === 31 || n === 32) return mapNum(16);
    if (n === 30) return null;
    return mapNum(n + 1);                  // 그 밖의 맵에서 비밀 출구는 일반 출구와 같다
  }
  const m = /^E(\d)M(\d)$/.exec(name);
  if (!m) return null;
  const e = Number(m[1]), n = Number(m[2]);
  if (secret) return `E${e}M9`;
  if (n === 9) return `E${e}M${RETURN_FROM_SECRET[e]}`;
  if (n === 8) return null;                // 에피소드 마지막
  return `E${e}M${n + 1}`;
};

/**
 * 둠2: 이 맵을 끝내고 점수 화면 다음에 보여 줄 이야기 화면 (원작 G_WorldDone). 없으면 null.
 * 6·11·20·30 을 끝냈을 때, 15·31 에서 비밀 출구로 나갔을 때.
 */
export const storyAfter = (name, secret) => {
  const d2 = /^MAP(\d\d)$/.exec(name);
  if (!d2) return null;
  const n = Number(d2[1]);
  return { 6: 'C1', 11: 'C2', 20: 'C3', 30: 'C4' }[n] ?? (secret ? { 15: 'C5', 31: 'C6' }[n] ?? null : null);
};

/** 둠2 맵 음악 (MAP01 → D_RUNNIN …) */
const DOOM2_SONGS = [
  'RUNNIN', 'STALKS', 'COUNTD', 'BETWEE', 'DOOM', 'THE_DA', 'SHAWN', 'DDTBLU', 'IN_CIT', 'DEAD',
  'STLKS2', 'THEDA2', 'DOOM2', 'DDTBL2', 'RUNNI2', 'DEAD2', 'STLKS3', 'ROMERO', 'SHAWN2', 'MESSAG',
  'COUNT2', 'DDTBL3', 'AMPIE', 'THEDA3', 'ADRIAN', 'MESSG2', 'ROMER2', 'TENSE', 'SHAWN3', 'OPENIN',
  'EVIL', 'ULTIMA',
];
export const mapSong = (name) => {
  const d2 = /^MAP(\d\d)$/.exec(name);
  return d2 ? `D_${DOOM2_SONGS[Number(d2[1]) - 1] ?? 'RUNNIN'}` : `D_${name}`;
};

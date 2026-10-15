/**
 * PLAYPAL(팔레트 14장) + COLORMAP(밝기 단계 34장) 로딩.
 * COLORMAP 0 = 최대 밝기, 31 = 가장 어두움, 32 = 무적(반전), 33 = 검정.
 * 렌더러가 바로 쓸 수 있게 "밝기 단계별 256색 → 32비트 픽셀" 표를 미리 만든다.
 * 밝기(감마) 조절은 표의 내용을 제자리에서 다시 채우므로, 표를 들고 있는 렌더러/HUD 는 그대로 쓰면 된다.
 */

/** 밝기 단계 0~4 의 감마 값 (0 = 보정 없음). 원작 gammatable 과 비슷한 곡선 */
const GAMMA = [1, 1.25, 1.6, 2.0, 2.5];
export const GAMMA_LEVELS = GAMMA.length;
const gammaTable = (level) => Uint8Array.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** (1 / GAMMA[level])));

/**
 * @returns {{ rgba: Uint32Array, lit: Uint32Array[], litFor(n): Uint32Array[], gamma: number, setGamma(level): void }}
 *   lit[밝기단계][팔레트 인덱스] = 픽셀 (기본 팔레트). litFor(n) = PLAYPAL n번 팔레트로 만든 같은 표 (피격·아이템 색조용, 필요할 때 만든다)
 */
export function loadPalette(wad, palIndex = 0) {
  const play = wad.getLump('PLAYPAL');
  const cmap = wad.getLump('COLORMAP');
  const numMaps = Math.floor(cmap.length / 256);
  let gt = gammaTable(0);

  const rgbaOf = (pal, i) => {
    const o = pal * 768 + i * 3;
    return (0xff000000 | (gt[play[o + 2]] << 16) | (gt[play[o + 1]] << 8) | gt[play[o]]) >>> 0; // ABGR (리틀엔디언 RGBA)
  };
  const fill = (pal, e) => {
    for (let i = 0; i < 256; i++) e.rgba[i] = rgbaOf(pal, i);
    for (let m = 0; m < numMaps; m++) for (let i = 0; i < 256; i++) e.lit[m][i] = e.rgba[cmap[m * 256 + i]];
  };
  const build = (pal) => {
    const e = { rgba: new Uint32Array(256), lit: Array.from({ length: numMaps }, () => new Uint32Array(256)) };
    fill(pal, e);
    return e;
  };

  const base = build(palIndex);
  const cache = new Map([[palIndex, base]]);
  const count = Math.floor(play.length / 768);
  const litFor = (n) => {
    if (n >= count) n = 0;
    if (!cache.has(n)) cache.set(n, build(n));
    return cache.get(n).lit;
  };
  const api = {
    rgba: base.rgba, lit: base.lit, litFor, gamma: 0,
    setGamma(level) {
      level = Math.max(0, Math.min(GAMMA.length - 1, level | 0));
      if (level === api.gamma) return;
      api.gamma = level; gt = gammaTable(level);
      for (const [pal, e] of cache) fill(pal, e);
    },
  };
  return api;
}

// PLAYPAL 의 색조 팔레트 번호 (원작 st_stuff.c)
const START_RED = 1, NUM_RED = 8, START_BONUS = 9, NUM_BONUS = 4, RADIATION = 13;

/** 지금 플레이어 상태에 맞는 팔레트 번호: 피격(빨강) > 아이템(금색) > 방사능복(초록) > 기본 (원작 ST_doPaletteStuff) */
export function tintPalette(p) {
  let cnt = p.damageCount;
  if (p.powers.berserk) cnt = Math.max(cnt, 12 - (p.powers.berserk >> 6));   // 버서크 직후엔 빨갛다가 서서히 풀림
  if (cnt) return START_RED + Math.min(NUM_RED - 1, (cnt + 7) >> 3);
  if (p.bonusCount) return START_BONUS + Math.min(NUM_BONUS - 1, (p.bonusCount + 7) >> 3);
  if (p.powers.radsuit > 4 * 32 || (p.powers.radsuit & 8)) return RADIATION;
  return 0;
}

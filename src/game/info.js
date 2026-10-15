/**
 * thing 종류 표 (맵의 type 번호 = doomednum → 정보). 크기는 원작 mobjinfo 기준.
 *  seq   : 애니메이션 프레임 글자 순서 ('ABCB' = A→B→C→B 반복)
 *  tics  : 프레임당 지속 tic (숫자 하나, 또는 프레임별 배열)
 *  bright: true = 항상 최대 밝기, 문자열 = 그 글자의 프레임만 최대 밝기
 *  solid : 이동을 막음 / ceiling : 천장에 매달림 / pickup : 먹을 수 있는 것의 종류 / monster : 몬스터(킬 수에 포함)
 */
const mk = (sprite, seq, tics, o = {}) => ({
  sprite, seq, tics, bright: false, radius: 20, height: 16,
  solid: false, ceiling: false, countItem: false, monster: false, pickup: null, fuzz: false, name: sprite, ...o,
});
const deco = (sprite, seq, tics, o = {}) => mk(sprite, seq, tics, { radius: 16, ...o });
const item = (sprite, pickup, o = {}) => mk(sprite, 'A', 6, { pickup, ...o });
const key = (sprite, pickup) => mk(sprite, 'AB', 10, { pickup, bright: 'B' });
const mon = (sprite, seq, tics, o = {}) => mk(sprite, seq, tics, { solid: true, monster: true, height: 56, ...o });

export const THING_INFO = {
  // ----- 몬스터 (Phase 6 에서 AI 를 붙인다: 지금은 서 있는 모습) -----
  3004: mon('POSS', 'AB', 10, { name: 'zombieman', hp: 20 }),
  9: mon('SPOS', 'AB', 10, { name: 'shotgun guy', hp: 30 }),
  3001: mon('TROO', 'AB', 10, { name: 'imp', hp: 60 }),
  3002: mon('SARG', 'AB', 10, { name: 'demon', hp: 150, radius: 30 }),
  58: mon('SARG', 'AB', 10, { name: 'spectre', hp: 150, radius: 30, fuzz: true }),
  3006: mon('SKUL', 'AB', 6, { name: 'lost soul', hp: 100, radius: 16, bright: true }),
  3005: mon('HEAD', 'A', 10, { name: 'cacodemon', hp: 400, radius: 31 }),
  3003: mon('BOSS', 'AB', 10, { name: 'baron of hell', hp: 1000, radius: 24, height: 64 }),

  // ----- 통 -----
  2035: mk('BAR1', 'AB', 6, { solid: true, radius: 10, height: 42, name: 'barrel' }),
  70: mk('FCAN', 'ABC', 4, { solid: true, radius: 10, height: 42, bright: true, name: 'burning barrel' }),

  // ----- 체력 / 방어구 -----
  2011: item('STIM', 'stimpack'),
  2012: item('MEDI', 'medikit'),
  2014: mk('BON1', 'ABCDCB', 6, { pickup: 'healthBonus', countItem: true }),
  2015: mk('BON2', 'ABCDCB', 6, { pickup: 'armorBonus', countItem: true }),
  2018: mk('ARM1', 'AB', [6, 7], { pickup: 'greenArmor', countItem: true, bright: 'B' }),
  2019: mk('ARM2', 'AB', [6, 7], { pickup: 'blueArmor', countItem: true, bright: 'B' }),
  2013: mk('SOUL', 'ABCDCB', 6, { pickup: 'soulsphere', countItem: true, bright: true }),

  // ----- 파워업 -----
  2022: mk('PINV', 'ABCD', 6, { pickup: 'invulnerability', countItem: true, bright: true }),
  2023: item('PSTR', 'berserk', { countItem: true, bright: true }),
  2024: mk('PINS', 'ABCD', 6, { pickup: 'invisibility', countItem: true, bright: true }),
  2025: item('SUIT', 'radsuit', { countItem: true, bright: true }),
  2026: mk('PMAP', 'ABCDCB', 6, { pickup: 'automap', countItem: true, bright: true }),
  2045: mk('PVIS', 'AB', 6, { pickup: 'lightamp', countItem: true, bright: true }),

  // ----- 탄약 -----
  2007: item('CLIP', 'clip'),
  2008: item('SHEL', 'shells'),
  2010: item('ROCK', 'rocket'),
  2047: item('CELL', 'cell'),
  2048: item('AMMO', 'clipBox'),
  2049: item('SBOX', 'shellBox'),
  2046: item('BROK', 'rocketBox'),
  17: item('CELP', 'cellPack'),
  8: item('BPAK', 'backpack'),

  // ----- 무기 -----
  2001: item('SHOT', 'shotgun'),
  2002: item('MGUN', 'chaingun'),
  2003: item('LAUN', 'rocketLauncher'),
  2004: item('PLAS', 'plasmaGun'),
  2006: item('BFUG', 'bfg'),
  2005: item('CSAW', 'chainsaw'),

  // ----- 열쇠 -----
  5: key('BKEY', 'blueCard'), 6: key('YKEY', 'yellowCard'), 13: key('RKEY', 'redCard'),
  40: key('BSKU', 'blueSkull'), 39: key('YSKU', 'yellowSkull'), 38: key('RSKU', 'redSkull'),

  // ----- 장식 (이동을 막는 것) -----
  25: deco('POL1', 'A', 6, { solid: true }),
  26: deco('POL6', 'AB', 6, { solid: true }),
  27: deco('POL4', 'A', 6, { solid: true }),
  28: deco('POL2', 'A', 6, { solid: true }),
  29: deco('POL3', 'AB', 6, { solid: true, bright: true }),
  30: deco('COL1', 'A', 6, { solid: true }),
  31: deco('COL2', 'A', 6, { solid: true }),
  32: deco('COL3', 'A', 6, { solid: true }),
  33: deco('COL4', 'A', 6, { solid: true }),
  35: deco('CBRA', 'A', 6, { solid: true, bright: true, height: 16 }),
  36: deco('COL5', 'AB', 14, { solid: true }),
  37: deco('COL6', 'A', 6, { solid: true }),
  41: deco('CEYE', 'ABCB', 6, { solid: true, bright: true }),
  42: deco('FSKU', 'ABC', 6, { solid: true, bright: true }),
  43: deco('TRE1', 'A', 6, { solid: true }),
  44: deco('TBLU', 'ABCD', 4, { solid: true, bright: true, height: 68 }),
  45: deco('TGRN', 'ABCD', 4, { solid: true, bright: true, height: 68 }),
  46: deco('TRED', 'ABCD', 4, { solid: true, bright: true, height: 68 }),
  47: deco('SMIT', 'A', 6, { solid: true }),
  48: deco('ELEC', 'A', 6, { solid: true }),
  54: deco('TRE2', 'A', 6, { solid: true, radius: 32 }),
  55: deco('SMBT', 'ABCD', 4, { solid: true, bright: true, height: 37 }),
  56: deco('SMGT', 'ABCD', 4, { solid: true, bright: true, height: 37 }),
  57: deco('SMRT', 'ABCD', 4, { solid: true, bright: true, height: 37 }),
  2028: deco('COLU', 'A', 6, { solid: true, bright: true }),
  // 천장에 매달린 것 (solid)
  49: deco('GOR1', 'ABCB', [10, 15, 8, 6], { solid: true, ceiling: true, height: 68 }),
  50: deco('GOR2', 'A', 6, { solid: true, ceiling: true, height: 68 }),
  51: deco('GOR3', 'A', 6, { solid: true, ceiling: true, height: 68 }),
  52: deco('GOR4', 'A', 6, { solid: true, ceiling: true, height: 68 }),
  53: deco('GOR5', 'A', 6, { solid: true, ceiling: true, height: 68 }),

  // ----- 장식 (지나갈 수 있는 것) -----
  10: deco('PLAY', 'W', 6), 12: deco('PLAY', 'W', 6), 15: deco('PLAY', 'N', 6),
  18: deco('POSS', 'L', 6), 19: deco('SPOS', 'L', 6), 20: deco('TROO', 'M', 6),
  21: deco('SARG', 'N', 6), 22: deco('HEAD', 'L', 6), 23: deco('SKUL', 'K', 6),
  24: deco('POL5', 'A', 6),
  34: deco('CAND', 'A', 6, { bright: true }),
  59: deco('GOR2', 'A', 6, { ceiling: true, height: 68 }),
  60: deco('GOR4', 'A', 6, { ceiling: true, height: 68 }),
  61: deco('GOR3', 'A', 6, { ceiling: true, height: 68 }),
  62: deco('GOR5', 'A', 6, { ceiling: true, height: 68 }),
  63: deco('GOR1', 'ABCB', [10, 15, 8, 6], { ceiling: true, height: 68 }),
};

/** 맵에는 있지만 화면에 그리지 않는 thing (플레이어 시작점, 텔레포트 도착점 등) */
export const INVISIBLE_THINGS = new Set([1, 2, 3, 4, 11, 14, 87]);

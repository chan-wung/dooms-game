/**
 * 몬스터 / 투사체 / 효과의 상태 표 (원작 info.c 의 수치).
 * 상태 = [프레임 글자, 지속 tic(-1 = 영원히), 들어갈 때 실행할 동작, 풀브라이트 여부]
 *  - 상태 목록(label)은 순서대로 진행하고, 끝나면 after[label] 로 이어진다
 *    (라벨 이름 = 다음 목록, 'remove' = 사라짐, 없으면 마지막 프레임에서 정지).
 *  - 동작은 monsters.js 의 ACTIONS 에서 이름으로 찾는다.
 */
const S = (f, t, a = null, b = false) => ({ f, t, a, b });
const run = (t, frames = 'ABCD') => [...frames].flatMap((f) => [S(f, t, 'chase'), S(f, t, 'chase')]);

export const AI = {
  // ---------- 좀비맨 (전직 병사) ----------
  POSS: {
    hp: 20, speed: 8, painChance: 200, mass: 100, reaction: 8, drop: 'clip',
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(4),
      attack: [S('E', 10, 'faceTarget'), S('F', 8, 'posAttack'), S('E', 8)],
      pain: [S('G', 3), S('G', 3, 'pain')],
      die: [S('H', 5), S('I', 5, 'scream'), S('J', 5, 'fall'), S('K', 5), S('L', -1)],
      xdie: [S('M', 5), S('N', 5, 'xscream'), S('O', 5, 'fall'), S('P', 5), S('Q', 5), S('R', 5), S('S', 5), S('T', 5), S('U', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: ['POSIT1', 'POSIT2', 'POSIT3'], attack: 'PISTOL', pain: 'POPAIN', die: ['PODTH1', 'PODTH2', 'PODTH3'], xdie: 'SLOP', active: 'POSACT' },
  },
  // ---------- 샷건맨 ----------
  SPOS: {
    hp: 30, speed: 8, painChance: 170, mass: 100, reaction: 8, drop: 'shotgun',
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 10, 'faceTarget'), S('F', 10, 'sposAttack'), S('E', 10)],
      pain: [S('G', 3), S('G', 3, 'pain')],
      die: [S('H', 5), S('I', 5, 'scream'), S('J', 5, 'fall'), S('K', 5), S('L', -1)],
      xdie: [S('M', 5), S('N', 5, 'xscream'), S('O', 5, 'fall'), S('P', 5), S('Q', 5), S('R', 5), S('S', 5), S('T', 5), S('U', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'SGTSIT', attack: 'SHOTGN', pain: 'POPAIN', die: ['PODTH1', 'PODTH2', 'PODTH3'], xdie: 'SLOP', active: 'POSACT' },
  },
  // ---------- 임프 ----------
  TROO: {
    hp: 60, speed: 8, painChance: 200, mass: 100, reaction: 8,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 8, 'faceTarget'), S('F', 8, 'faceTarget'), S('G', 6, 'troopAttack')],
      pain: [S('H', 2), S('H', 2, 'pain')],
      die: [S('I', 8), S('J', 8, 'scream'), S('K', 6), S('L', 6, 'fall'), S('M', -1)],
      xdie: [S('N', 5), S('O', 5, 'xscream'), S('P', 5), S('Q', 5, 'fall'), S('R', 5), S('S', 5), S('T', 5), S('U', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    melee: 'attack', missile: 'attack', painState: 'pain',
    sounds: { see: ['BGSIT1', 'BGSIT2'], melee: 'CLAW', pain: 'POPAIN', die: ['BGDTH1', 'BGDTH2'], xdie: 'SLOP', active: 'BGACT' },
  },
  // ---------- 데몬 / 스펙터 ----------
  SARG: {
    hp: 150, speed: 10, painChance: 180, mass: 400, reaction: 8,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(2),
      attack: [S('E', 8, 'faceTarget'), S('F', 8, 'faceTarget'), S('G', 8, 'sargAttack')],
      pain: [S('H', 2), S('H', 2, 'pain')],
      die: [S('I', 8), S('J', 8, 'scream'), S('K', 4), S('L', 4, 'fall'), S('M', 4), S('N', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    melee: 'attack', painState: 'pain',
    sounds: { see: 'SGTSIT', melee: 'SGTATK', pain: 'DMPAIN', die: 'SGTDTH', active: 'DMACT' },
  },
  // ---------- 바론 오브 헬 ----------
  BOSS: {
    hp: 1000, speed: 8, painChance: 50, mass: 1000, reaction: 8,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 8, 'faceTarget'), S('F', 8, 'faceTarget'), S('G', 8, 'bruisAttack')],
      pain: [S('H', 2), S('H', 2, 'pain')],
      die: [S('I', 8), S('J', 8, 'scream'), S('K', 8), S('L', 8, 'fall'), S('M', 8), S('N', 8, 'bossDeath'), S('O', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    melee: 'attack', missile: 'attack', painState: 'pain',
    sounds: { see: 'BRSSIT', melee: 'CLAW', pain: 'POPAIN', die: 'BRSDTH', active: 'DMACT' },
  },
  // ---------- 통 ----------
  BAR1: {
    hp: 20, speed: 0, painChance: 0, mass: 100, reaction: 0, noBlood: true,
    states: {
      stand: [S('A', 6), S('B', 6)],
      die: [S('A', 5, null, true), S('B', 5, 'scream', true), S('C', 5, null, true), S('D', 10, 'explode', true), S('E', 10, null, true)],
    },
    after: { stand: 'stand', die: 'remove' },
    sounds: { die: 'BAREXP' },
  },

  // ---------- 투사체 ----------
  troopShot: {   // 임프 불덩이
    sprite: 'BAL1', missile: { speed: 10, damage: 3, sound: 'FIRSHT', deathSound: 'FIRXPL' }, radius: 6, height: 8,
    states: { fly: [S('A', 4, null, true), S('B', 4, null, true)], die: [S('C', 6, null, true), S('D', 6, null, true), S('E', 6, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },
  bruiserShot: { // 바론 불덩이
    sprite: 'BAL7', missile: { speed: 15, damage: 8, sound: 'FIRSHT', deathSound: 'FIRXPL' }, radius: 6, height: 8,
    states: { fly: [S('A', 4, null, true), S('B', 4, null, true)], die: [S('C', 6, null, true), S('D', 6, null, true), S('E', 6, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },
  rocket: {      // 로켓
    sprite: 'MISL', missile: { speed: 20, damage: 20, sound: 'RLAUNC', deathSound: 'BAREXP' }, radius: 11, height: 8,
    states: { fly: [S('A', 1, null, true)], die: [S('B', 8, 'explode', true), S('C', 6, null, true), S('D', 4, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },

  // ---------- 효과 ----------
  puff: {        // 총알이 벽에 맞은 먼지
    sprite: 'PUFF', effect: true, radius: 0, height: 0, rise: 1,
    states: { fly: [S('A', 4, null, true), S('B', 4), S('C', 4), S('D', 4)] }, after: { fly: 'remove' },
  },
  blood: {       // 피 (큰 것 → 작은 것 순서로 맞는 데미지에 따라 시작 프레임이 달라진다)
    sprite: 'BLUD', effect: true, radius: 0, height: 0, rise: 2,
    states: {
      fly: [S('C', 8), S('B', 8), S('A', 8)],
      fly2: [S('B', 8), S('A', 8)],
      fly3: [S('A', 8)],
    },
    after: { fly: 'remove', fly2: 'remove', fly3: 'remove' },
  },
};

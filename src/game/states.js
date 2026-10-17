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
  // ---------- 카코데몬 (떠다닌다) ----------
  HEAD: {
    hp: 400, speed: 8, painChance: 128, mass: 400, reaction: 8, float: true,
    states: {
      stand: [S('A', 10, 'look')],
      run: [S('A', 3, 'chase')],
      attack: [S('B', 5, 'faceTarget'), S('C', 5, 'faceTarget'), S('D', 5, 'headAttack', true)],
      pain: [S('E', 3), S('E', 3, 'pain'), S('F', 6)],
      die: [S('G', 8), S('H', 8, 'scream'), S('I', 8), S('J', 8), S('K', 8, 'fall'), S('L', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    melee: 'attack', missile: 'attack', painState: 'pain',
    sounds: { see: 'CACSIT', pain: 'DMPAIN', die: 'CACDTH', active: 'DMACT' },
  },
  // ---------- 로스트 소울 (떠다니다가 돌진한다. 킬 수에 들어가지 않는다) ----------
  SKUL: {
    hp: 100, speed: 8, painChance: 256, mass: 50, reaction: 8, float: true, noGravity: true, noBlood: true, missileHalf: true,
    states: {
      stand: [S('A', 10, 'look', true), S('B', 10, 'look', true)],
      run: [S('A', 6, 'chase', true), S('B', 6, 'chase', true)],
      attack: [S('C', 10, 'faceTarget', true), S('D', 4, 'skullAttack', true)],
      charge: [S('C', 4, null, true), S('D', 4, null, true)],
      pain: [S('E', 3, null, true), S('E', 3, 'pain', true)],
      die: [S('F', 6, null, true), S('G', 6, 'scream', true), S('H', 6, null, true), S('I', 6, 'fall', true), S('J', 6), S('K', 6)],
    },
    after: { stand: 'stand', run: 'run', attack: 'charge', charge: 'charge', pain: 'run', die: 'remove' },
    missile: 'attack', painState: 'pain',
    sounds: { attack: 'SKLATK', pain: 'DMPAIN', die: 'FIRXPL', active: 'DMACT' },
  },
  // ---------- 사이버데몬 (폭발 피해를 받지 않는다) ----------
  CYBR: {
    hp: 4000, speed: 16, painChance: 20, mass: 1000, reaction: 8, noRadiusDamage: true, missileHalf: true, missileCap: 160,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: [S('A', 3, 'hoof'), S('A', 3, 'chase'), S('B', 3, 'chase'), S('B', 3, 'chase'), S('C', 3, 'chase'), S('C', 3, 'chase'), S('D', 3, 'metal'), S('D', 3, 'chase')],
      attack: [S('E', 6, 'faceTarget'), S('F', 12, 'cyberAttack'), S('E', 12, 'faceTarget'), S('F', 12, 'cyberAttack'), S('E', 12, 'faceTarget'), S('F', 12, 'cyberAttack')],
      pain: [S('G', 10, 'pain')],
      die: [S('H', 10), S('I', 10, 'scream'), S('J', 10), S('K', 10), S('L', 10), S('M', 10, 'fall'), S('N', 10), S('O', 10), S('P', 30), S('P', -1, 'bossDeath')],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'CYBSIT', pain: 'DMPAIN', die: 'CYBDTH', active: 'DMACT' },
  },
  // ---------- 스파이더 마스터마인드 (폭발 피해를 받지 않는다) ----------
  SPID: {
    hp: 3000, speed: 12, painChance: 40, mass: 1000, reaction: 8, noRadiusDamage: true, missileHalf: true,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: [S('A', 3, 'metal'), S('A', 3, 'chase'), S('B', 3, 'chase'), S('B', 3, 'chase'), S('C', 3, 'metal'), S('C', 3, 'chase'),
        S('D', 3, 'chase'), S('D', 3, 'chase'), S('E', 3, 'metal'), S('E', 3, 'chase'), S('F', 3, 'chase'), S('F', 3, 'chase')],
      attack: [S('A', 20, 'faceTarget')],
      fire: [S('G', 4, 'sposAttack', true), S('H', 4, 'sposAttack', true), S('H', 1, 'spidRefire', true)],
      pain: [S('I', 3), S('I', 3, 'pain')],
      die: [S('J', 20, 'scream'), S('K', 10, 'fall'), S('L', 10), S('M', 10), S('N', 10), S('O', 10), S('P', 10), S('Q', 10), S('R', 10), S('S', 30), S('S', -1, 'bossDeath')],
    },
    after: { stand: 'stand', run: 'run', attack: 'fire', fire: 'fire', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'SPISIT', attack: 'SHOTGN', pain: 'DMPAIN', die: 'SPIDTH', active: 'DMACT' },
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
  headShot: {    // 카코데몬 불덩이
    sprite: 'BAL2', missile: { speed: 10, damage: 5, sound: 'FIRSHT', deathSound: 'FIRXPL' }, radius: 6, height: 8,
    states: { fly: [S('A', 4, null, true), S('B', 4, null, true)], die: [S('C', 6, null, true), S('D', 6, null, true), S('E', 6, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },
  plasma: {      // 플라즈마 (터질 때는 PLSE 그림)
    sprite: 'PLSS', dieSprite: 'PLSE', missile: { speed: 25, damage: 5, sound: 'PLASMA', deathSound: 'FIRXPL' }, radius: 13, height: 8,
    states: { fly: [S('A', 6, null, true), S('B', 6, null, true)], die: [...'ABCDE'].map((f) => S(f, 4, null, true)) },
    after: { fly: 'fly', die: 'remove' },
  },
  bfgBall: {     // BFG 공 (터지면 쏜 사람 정면 90° 안에 광선 40 줄: bfgSpray)
    sprite: 'BFS1', dieSprite: 'BFE1', missile: { speed: 25, damage: 100, sound: null, deathSound: 'RXPLOD' }, radius: 13, height: 8,
    states: {
      fly: [S('A', 4, null, true), S('B', 4, null, true)],
      die: [S('A', 8, null, true), S('B', 8, null, true), S('C', 8, 'bfgSpray', true), S('D', 8, null, true), S('E', 8, null, true), S('F', 8, null, true)],
    },
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
  bfgHit: {      // BFG 광선이 맞은 자리
    sprite: 'BFE2', effect: true, radius: 0, height: 0,
    states: { fly: [...'ABCD'].map((f) => S(f, 8, null, true)) }, after: { fly: 'remove' },
  },
  tfog: {        // 텔레포트 안개 (출발·도착 지점, 부활할 때)
    sprite: 'TFOG', effect: true, radius: 0, height: 0,
    states: { fly: [...'ABABCDEFGHIJ'].map((f) => S(f, 6, null, true)) }, after: { fly: 'remove' },
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

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
  // ================= 둠2 =================
  // ---------- 체인거너 (헤비 웨폰 듀드) ----------
  CPOS: {
    hp: 70, speed: 8, painChance: 170, mass: 100, reaction: 8, drop: 'chaingun',
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 10, 'faceTarget')],
      fire: [S('F', 4, 'cposAttack', true), S('E', 4, 'cposAttack', true), S('F', 1, 'cposRefire')],
      pain: [S('G', 3), S('G', 3, 'pain')],
      die: [S('H', 5), S('I', 5, 'scream'), S('J', 5, 'fall'), S('K', 5), S('L', 5), S('M', 5), S('N', -1)],
      xdie: [S('O', 5), S('P', 5, 'xscream'), S('Q', 5, 'fall'), S('R', 5), S('S', 5), S('T', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'fire', fire: 'fire', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: ['POSIT2', 'POSIT3'], pain: 'POPAIN', die: ['PODTH1', 'PODTH2', 'PODTH3'], xdie: 'SLOP', active: 'POSACT' },
  },
  // ---------- 울펜슈타인 SS ----------
  SSWV: {
    hp: 50, speed: 8, painChance: 170, mass: 100, reaction: 8, drop: 'clip',
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 10, 'faceTarget')],
      fire: [S('F', 10, 'faceTarget'), S('G', 4, 'cposAttack', true), S('F', 6, 'faceTarget'), S('G', 4, 'cposAttack', true), S('F', 1, 'cposRefire')],
      pain: [S('H', 3), S('H', 3, 'pain')],
      die: [S('I', 5), S('J', 5, 'scream'), S('K', 5, 'fall'), S('L', 5), S('M', -1)],
      xdie: [S('N', 5), S('O', 5, 'xscream'), S('P', 5, 'fall'), S('Q', 5), S('R', 5), S('S', 5), S('T', 5), S('U', 5), S('V', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'fire', fire: 'fire', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'SSSIT', pain: 'POPAIN', die: 'SSDTH', xdie: 'SLOP', active: 'POSACT' },
  },
  // ---------- 헬 나이트 (바론과 같고 약하다) ----------
  BOS2: {
    hp: 500, speed: 8, painChance: 50, mass: 1000, reaction: 8,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(3),
      attack: [S('E', 8, 'faceTarget'), S('F', 8, 'faceTarget'), S('G', 8, 'bruisAttack')],
      pain: [S('H', 2), S('H', 2, 'pain')],
      die: [S('I', 8), S('J', 8, 'scream'), S('K', 8), S('L', 8, 'fall'), S('M', 8), S('N', 8), S('O', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    melee: 'attack', missile: 'attack', painState: 'pain',
    sounds: { see: 'KNTSIT', melee: 'CLAW', pain: 'POPAIN', die: 'KNTDTH', active: 'DMACT' },
  },
  // ---------- 레버넌트 (유도 미사일, 주먹) ----------
  SKEL: {
    hp: 300, speed: 10, painChance: 100, mass: 500, reaction: 8, missileHalf: true, minMissile: 196,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: run(2, 'ABCDEF'),
      fist: [S('G', 0, 'faceTarget'), S('G', 6, 'skelWhoosh'), S('H', 6, 'faceTarget'), S('I', 6, 'skelFist')],
      missile: [S('J', 0, 'faceTarget', true), S('J', 10, 'faceTarget', true), S('K', 10, 'skelMissile'), S('K', 10, 'faceTarget')],
      pain: [S('L', 5), S('L', 5, 'pain')],
      die: [S('L', 7), S('M', 7), S('N', 7, 'scream'), S('O', 7, 'fall'), S('P', 7), S('Q', -1)],
    },
    after: { stand: 'stand', run: 'run', fist: 'run', missile: 'run', pain: 'run' },
    melee: 'fist', missile: 'missile', painState: 'pain',
    sounds: { see: 'SKESIT', pain: 'POPAIN', die: 'SKEDTH', active: 'SKEACT' },
  },
  // ---------- 맨큐버스 (양손 불덩이를 세 번) ----------
  FATT: {
    hp: 600, speed: 8, painChance: 80, mass: 1000, reaction: 8,
    states: {
      stand: [S('A', 15, 'look'), S('B', 15, 'look')],
      run: run(4, 'ABCDEF'),
      attack: [S('G', 20, 'fatRaise'), S('H', 10, 'fatAttack1', true), S('I', 5, 'faceTarget'), S('G', 5, 'faceTarget'),
        S('H', 10, 'fatAttack2', true), S('I', 5, 'faceTarget'), S('G', 5, 'faceTarget'), S('H', 10, 'fatAttack3', true),
        S('I', 5, 'faceTarget'), S('G', 5, 'faceTarget')],
      pain: [S('J', 3), S('J', 3, 'pain')],
      die: [S('K', 6), S('L', 6, 'scream'), S('M', 6, 'fall'), S('N', 6), S('O', 6), S('P', 6), S('Q', 6), S('R', 6), S('S', 6), S('T', -1, 'bossDeath')],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'MANSIT', pain: 'MNPAIN', die: 'MANDTH', active: 'POSACT' },
  },
  // ---------- 아라크노트론 (플라즈마 연사) ----------
  BSPI: {
    hp: 500, speed: 12, painChance: 128, mass: 600, reaction: 8,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: [S('A', 3, 'babyMetal'), S('A', 3, 'chase'), S('B', 3, 'chase'), S('B', 3, 'chase'), S('C', 3, 'chase'), S('C', 3, 'chase'),
        S('D', 3, 'babyMetal'), S('D', 3, 'chase'), S('E', 3, 'chase'), S('E', 3, 'chase'), S('F', 3, 'chase'), S('F', 3, 'chase')],
      attack: [S('A', 20, 'faceTarget', true)],
      fire: [S('G', 4, 'bspiAttack', true), S('H', 4, null, true), S('H', 4, 'spidRefire', true)],
      pain: [S('I', 3), S('I', 3, 'pain')],
      die: [S('J', 20, 'scream'), S('K', 7, 'fall'), S('L', 7), S('M', 7), S('N', 7), S('O', 7), S('P', -1, 'bossDeath')],
    },
    after: { stand: 'stand', run: 'run', attack: 'fire', fire: 'fire', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'BSPSIT', pain: 'DMPAIN', die: 'BSPDTH', active: 'BSPACT' },
  },
  // ---------- 페인 엘리멘탈 (로스트 소울을 뱉는다) ----------
  PAIN: {
    hp: 400, speed: 8, painChance: 128, mass: 400, reaction: 8, float: true,
    states: {
      stand: [S('A', 10, 'look')],
      run: [S('A', 3, 'chase'), S('A', 3, 'chase'), S('B', 3, 'chase'), S('B', 3, 'chase'), S('C', 3, 'chase'), S('C', 3, 'chase')],
      attack: [S('D', 5, 'faceTarget'), S('E', 5, 'faceTarget'), S('F', 5, 'faceTarget', true), S('F', 0, 'painAttack', true)],
      pain: [S('G', 6), S('G', 6, 'pain')],
      die: [S('H', 8, null, true), S('I', 8, 'scream', true), S('J', 8, null, true), S('K', 8, null, true), S('L', 8, 'painDie', true), S('M', 8, null, true)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', pain: 'run', die: 'remove' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'PESIT', pain: 'PEPAIN', die: 'PEDTH', active: 'DMACT' },
  },
  // ---------- 아크바일 (시체를 되살리고, 불기둥으로 공격) ----------
  VILE: {
    hp: 700, speed: 15, painChance: 10, mass: 500, reaction: 8, maxMissile: 14 * 64,
    states: {
      stand: [S('A', 10, 'look'), S('B', 10, 'look')],
      run: [...'AABBCCDDEEFF'].map((f) => S(f, 2, 'vileChase')),
      attack: [S('G', 0, 'vileStart', true), S('G', 10, 'faceTarget', true), S('H', 8, 'vileTarget', true), S('I', 8, 'faceTarget', true),
        S('J', 8, 'faceTarget', true), S('K', 8, 'faceTarget', true), S('L', 8, 'faceTarget', true), S('M', 8, 'faceTarget', true),
        S('N', 8, 'vileAttack', true), S('O', 8, 'faceTarget', true), S('P', 20, null, true)],
      heal: [S('[', 10, null, true), S('\\', 10, null, true), S(']', 10, null, true)],   // 프레임 글자 [ \ ] = 26·27·28
      pain: [S('Q', 5), S('Q', 5, 'pain')],
      die: [S('Q', 7), S('R', 7, 'scream'), S('S', 7, 'fall'), S('T', 7), S('U', 7), S('V', 7), S('W', 7), S('X', 5), S('Y', 5), S('Z', -1)],
    },
    after: { stand: 'stand', run: 'run', attack: 'run', heal: 'run', pain: 'run' },
    missile: 'attack', painState: 'pain',
    sounds: { see: 'VILSIT', pain: 'VIPAIN', die: 'VILDTH', active: 'VILACT' },
  },
  // ---------- 커맨더 킨 (천장에 매달림, 모두 죽으면 태그 666 문이 열린다) ----------
  KEEN: {
    hp: 100, speed: 0, painChance: 256, mass: 10000000, reaction: 8, noGravity: true,
    states: {
      stand: [S('A', -1)],
      pain: [S('M', 4), S('M', 8, 'pain')],
      die: [S('A', 6), S('B', 6), S('C', 6, 'scream'), S('D', 6), S('E', 6), S('F', 6), S('G', 6), S('H', 6), S('I', 6), S('J', 6), S('K', 6, 'keenDie'), S('L', -1)],
    },
    after: { pain: 'stand' },
    painState: 'pain',
    sounds: { pain: 'KEENPN', die: 'KEENDT' },
  },
  // ---------- 아이콘 오브 신: 뇌 (맞으면 아파하고, 죽으면 게임 끝) ----------
  BBRN: {
    hp: 250, speed: 0, painChance: 255, mass: 10000000, reaction: 8,
    states: {
      stand: [S('A', -1)],
      pain: [S('B', 36, 'brainPain')],
      die: [S('A', 100, 'brainScream'), S('A', 10), S('A', 10), S('A', -1, 'brainDie')],
    },
    after: { pain: 'stand' },
    painState: 'pain',
  },
  // ---------- 아이콘 오브 신: 큐브를 쏘는 눈 (보이지 않음, 플레이어를 보면 깨어난다) ----------
  BOSSEYE: {
    hp: 0, speed: 0, painChance: 0, mass: 100, reaction: 0,
    states: {
      stand: [S('A', 10, 'look')],
      run: [S('A', 181, 'brainAwake')],
      spit: [S('A', 150, 'brainSpit')],
    },
    after: { stand: 'stand', run: 'spit', spit: 'spit' },
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
  tracer: {      // 레버넌트 유도 미사일 (터질 때는 FBXP 그림)
    sprite: 'FATB', dieSprite: 'FBXP', missile: { speed: 10, damage: 10, sound: 'SKEATK', deathSound: 'BAREXP' }, radius: 11, height: 8,
    states: { fly: [S('A', 2, 'tracer', true), S('B', 2, 'tracer', true)], die: [S('A', 8, null, true), S('B', 6, null, true), S('C', 4, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },
  fatShot: {     // 맨큐버스 불덩이
    sprite: 'MANF', dieSprite: 'MISL', missile: { speed: 20, damage: 8, sound: 'FIRSHT', deathSound: 'FIRXPL' }, radius: 6, height: 8,
    states: { fly: [S('A', 4, null, true), S('B', 4, null, true)], die: [S('B', 8, null, true), S('C', 6, null, true), S('D', 4, null, true)] },
    after: { fly: 'fly', die: 'remove' },
  },
  arachPlaz: {   // 아라크노트론 플라즈마
    sprite: 'APLS', dieSprite: 'APBX', missile: { speed: 25, damage: 5, sound: 'PLASMA', deathSound: 'FIRXPL' }, radius: 13, height: 8,
    states: { fly: [S('A', 5, null, true), S('B', 5, null, true)], die: [...'ABCDE'].map((f) => S(f, 5, null, true)) },
    after: { fly: 'fly', die: 'remove' },
  },
  spawnCube: {   // 아이콘 오브 신의 큐브: 벽을 뚫고 날아가 목표 지점에서 몬스터를 부른다
    sprite: 'BOSF', noClip: true, missile: { speed: 10, damage: 3, sound: 'BOSPIT', deathSound: null }, radius: 6, height: 32,
    states: { fly: [S('A', 3, 'spawnSound', true), S('B', 3, 'spawnFly', true), S('C', 3, 'spawnFly', true), S('D', 3, 'spawnFly', true)], die: [S('A', 1)] },
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
  smoke: {       // 레버넌트 미사일 꼬리 연기
    sprite: 'PUFF', effect: true, radius: 0, height: 0, rise: 1,
    states: { fly: [S('B', 4), S('C', 4), S('B', 4), S('C', 4), S('D', 4)] }, after: { fly: 'remove' },
  },
  vileFire: {    // 아크바일 불기둥 (대상 앞을 따라다닌다)
    sprite: 'FIRE', effect: true, radius: 0, height: 0, rise: 0,
    states: {
      fly: [S('A', 2, 'startFire', true),
        ...[...'BABCBCBCDCDCDEDEDEFEFEFGHGHGH'].map((f, i) => S(f, 2, i === 3 || i === 18 ? 'fireCrackle' : 'fire', true))],
    },
    after: { fly: 'remove' },
  },
  spawnFire: {   // 큐브가 몬스터를 부를 때의 불꽃
    sprite: 'FIRE', effect: true, radius: 0, height: 0,
    states: { fly: [...'ABCDEFGH'].map((f) => S(f, 4, null, true)) }, after: { fly: 'remove' },
  },
  brainBoom: {   // 뇌가 죽을 때 사방에서 터지는 폭발
    sprite: 'MISL', effect: true, radius: 0, height: 0, rise: 0,
    states: { fly: [S('B', 10, null, true), S('C', 10, null, true), S('D', 10, null, true)] }, after: { fly: 'remove' },
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


// ---------- 되살아나기 (아크바일): 쓰러지는 그림을 거꾸로 돌려 다시 일어선다 ----------
const RAISABLE = ['POSS', 'SPOS', 'CPOS', 'SSWV', 'TROO', 'SARG', 'HEAD', 'BOS2', 'BOSS', 'SKEL', 'FATT', 'BSPI'];
for (const k of RAISABLE) {
  const ai = AI[k];
  ai.states.raise = ai.states.die.filter((s) => s.t !== -1).reverse().map((s) => S(s.f, 5));
  ai.after.raise = 'run';
}

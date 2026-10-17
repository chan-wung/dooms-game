import { sectorAt } from '../render/bsp.js';
import { GRAVITY, MAXMOVE, STOPSPEED, FRICTION } from './physics.js';
import { normAngle, spread, splitMove } from './util.js';
import { Mobj } from './mobj.js';
import {
  MELEE_RANGE, MISSILE_RANGE, approxDist, checkSight, aimLineAttack, lineAttack, damageMobj, radiusAttack, spawnPuff,
} from './combat.js';
import { THING_INFO } from './info.js';

/**
 * 몬스터 AI (원작 p_enemy.c 의 A_Look / A_Chase / 공격 동작)와 물체 이동(p_mobj.c).
 * 몬스터의 상태 진행은 Mobj(states.js 의 표)가 하고, 여기는 "들어갈 때 실행되는 동작"과 이동 규칙을 둔다.
 */
const DI_NODIR = 8;
const XSPEED = [1, 0.717, 0, -0.717, -1, -0.717, 0, 0.717];  // 8방향 이동 단위 (E, NE, N, NW, W, SW, S, SE)
const YSPEED = [0, 0.717, 1, 0.717, 0, -0.717, -1, -0.717];
const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3, DI_NODIR];
const DIAGS = [3, 1, 5, 7]; // [(dy<0)<<1 + (dx>0)] → NW, NE, SW, SE
const FLOAT_SPEED = 4, SKULL_SPEED = 20;

/**
 * 보스 맵: 이 종류(doomednum)가 모두 죽으면 then
 *  floor = 태그 666 바닥을 가장 낮게, door = 태그 666 문 열기, exit = 맵 끝, texture = 태그 667 바닥을 아래 텍스처만큼 올림
 */
const BOSS_MAPS = {
  E1M8: [{ type: 3003, then: 'floor' }],   // 바론 오브 헬
  E2M8: [{ type: 16, then: 'exit' }],      // 사이버데몬
  E3M8: [{ type: 7, then: 'exit' }],       // 스파이더 마스터마인드
  E4M6: [{ type: 16, then: 'door' }],
  E4M8: [{ type: 7, then: 'floor' }],
  MAP07: [{ type: 67, then: 'floor' }, { type: 68, then: 'texture' }],   // 둠2: 맨큐버스 → 666 내림, 아라크노트론 → 667 올림
};
const FAT_SPREAD = Math.PI / 16;            // 맨큐버스 불덩이 벌어짐 (원작 ANG90/8)
const TRACE_ANGLE = (0xc000000 / 2 ** 32) * Math.PI * 2;   // 레버넌트 미사일이 한 번에 꺾는 각도 (약 17°)
const MAX_SKULLS = 20;                      // 페인 엘리멘탈: 맵에 로스트 소울이 이보다 많으면 더 뱉지 않는다
/** 큐브가 부르는 몬스터 (원작 A_SpawnFly 의 확률표: 0..255 난수가 경계보다 작으면) */
const CUBE_SPAWNS = [[50, 3001], [90, 3002], [120, 58], [130, 71], [160, 3005], [162, 64], [172, 66], [192, 68], [222, 67], [246, 69], [256, 3003]];

/** 이 몬스터의 소리 종류(see/attack/pain/die …) 하나를 낸다 (여러 개면 무작위) */
const say = (game, m, kind) => {
  const snd = m.ai.sounds?.[kind];
  if (!snd) return;
  game.playSound(Array.isArray(snd) ? snd[game.rnd() % snd.length] : snd, m);
};

// ---------- 시야 / 대상 찾기 ----------
function lookForPlayers(game, m, allAround) {
  const p = game.player;
  if (p.health <= 0) return false;
  if (!allAround) {
    // 뒤통수는 못 본다 (아주 가까우면 알아챔)
    const an = normAngle(Math.atan2(p.y - m.y, p.x - m.x) - m.angle);
    if (Math.abs(an) > Math.PI / 2 && approxDist(p.x - m.x, p.y - m.y) > MELEE_RANGE) return false;
  }
  if (!checkSight(game, m, p)) return false;
  m.target = p;
  return true;
}

// ---------- 이동 ----------
/** 몬스터 이동 규칙으로 (nx, ny) 로 이동 시도 */
function tryMoveMobj(game, m, nx, ny) {
  return game.physics.tryMove(m, nx, ny, { ignore: m, monster: true, dropoff: m.corpse || m.floating });   // 떠다니는 것은 낭떠러지를 겁내지 않는다
}

/** 떠다니는 몬스터가 턱·천장에 막혔을 때: 높이만 바꾸면 지나갈 수 있으면 위/아래로 4 만큼 (원작 P_Move 의 floatok) */
function floatPast(game, m, nx, ny) {
  const r = game.physics.check(nx, ny, m.z, m.height, m.radius, { ignore: m, monster: true });
  const floorz = r.floorz, ceilz = r.ceilz;
  if (ceilz - floorz < m.height) return false;
  const tz = m.z < floorz ? floorz : ceilz - m.height;
  if (game.physics.check(nx, ny, tz, m.height, m.radius, { ignore: m, monster: true }).blocked) return false;   // 벽이나 다른 물체
  m.z += m.z < floorz ? FLOAT_SPEED : -FLOAT_SPEED;
  return true;
}

/** 한 걸음 (speed × 방향). 막히면 문을 열어 본다 */
function move(game, m) {
  if (m.moveDir === DI_NODIR) return false;
  const nx = m.x + m.ai.speed * XSPEED[m.moveDir], ny = m.y + m.ai.speed * YSPEED[m.moveDir];
  const ox = m.x, oy = m.y;
  if (!tryMoveMobj(game, m, nx, ny)) {
    // 막은 선 중에 열 수 있는 문(특수 1)이 있으면 연다
    let good = false;
    for (const ld of game.physics.result.blockers) {
      if (ld.special === 1 && game.specials.monsterUse(ld, m)) good = true;
    }
    if (good) { m.moveDir = DI_NODIR; return true; }
    return !!m.floating && floatPast(game, m, nx, ny);
  }
  game.specials.crossLines(m, ox, oy);   // 텔레포트 선 · 문 · 리프트 선을 밟았으면 작동 (텔레포트하면 floorz 도 새 자리 것)
  if (!m.floating) m.z = m.floorz;
  return true;
}

function tryWalk(game, m) {
  if (!move(game, m)) return false;
  m.moveCount = game.rnd() & 15;
  return true;
}

/** 대상 쪽으로 갈 8방향 중 하나를 고른다 (직선 → 한 축 → 이전 방향 → 아무 방향) */
function newChaseDir(game, m) {
  const t = m.target;
  if (!t) return;
  const oldDir = m.moveDir, turnaround = OPPOSITE[oldDir];
  const dx = t.x - m.x, dy = t.y - m.y;
  const d = [DI_NODIR, dx > 10 ? 0 : dx < -10 ? 4 : DI_NODIR, dy < -10 ? 6 : dy > 10 ? 2 : DI_NODIR];

  if (d[1] !== DI_NODIR && d[2] !== DI_NODIR) {
    m.moveDir = DIAGS[((dy < 0 ? 1 : 0) << 1) + (dx > 0 ? 1 : 0)];
    if (m.moveDir !== turnaround && tryWalk(game, m)) return;
  }
  if (game.rnd() > 200 || Math.abs(dy) > Math.abs(dx)) { const tmp = d[1]; d[1] = d[2]; d[2] = tmp; }
  if (d[1] === turnaround) d[1] = DI_NODIR;
  if (d[2] === turnaround) d[2] = DI_NODIR;
  if (d[1] !== DI_NODIR) { m.moveDir = d[1]; if (tryWalk(game, m)) return; }
  if (d[2] !== DI_NODIR) { m.moveDir = d[2]; if (tryWalk(game, m)) return; }
  if (oldDir !== DI_NODIR) { m.moveDir = oldDir; if (tryWalk(game, m)) return; }

  // 직접 가는 길이 없으면 아무 방향이나 (순서는 무작위)
  if (game.rnd() & 1) {
    for (let dir = 0; dir <= 7; dir++) if (dir !== turnaround) { m.moveDir = dir; if (tryWalk(game, m)) return; }
  } else {
    for (let dir = 7; dir >= 0; dir--) if (dir !== turnaround) { m.moveDir = dir; if (tryWalk(game, m)) return; }
  }
  if (turnaround !== DI_NODIR) { m.moveDir = turnaround; if (tryWalk(game, m)) return; }
  m.moveDir = DI_NODIR; // 움직일 수 없음
}

function checkMeleeRange(game, m) {
  const t = m.target;
  if (!t || !t.shootable) return false;
  if (approxDist(t.x - m.x, t.y - m.y) >= MELEE_RANGE - 20 + t.radius) return false;
  return checkSight(game, m, t);
}

function checkMissileRange(game, m) {
  if (!checkSight(game, m, m.target)) return false;
  if (m.justHit) { m.justHit = false; return true; }  // 방금 맞았다 → 반격
  if (m.reaction) return false;                         // 아직 깨어난 지 얼마 안 됨
  let dist = approxDist(m.x - m.target.x, m.y - m.target.y) - 64;
  if (!m.ai.melee) dist -= 128;                          // 근접 공격이 없으면 더 자주 쏜다
  dist = Math.floor(dist);
  if (m.ai.maxMissile && dist > m.ai.maxMissile) return false;   // 아크바일: 너무 멀다
  if (m.ai.minMissile && dist < m.ai.minMissile) return false;   // 레버넌트: 너무 가깝다 (주먹을 쓴다)
  if (m.ai.missileHalf) dist >>= 1;                      // 사이버데몬·스파이더·로스트 소울은 더 자주
  dist = Math.min(200, m.ai.missileCap ?? 200, dist);
  return !(game.rnd() < dist);
}

// ---------- 동작 (상태에 들어갈 때 실행) ----------
const faceTarget = (m, game) => {
  if (!m.target) return;
  m.ambush = false;
  m.angle = Math.atan2(m.target.y - m.y, m.target.x - m.x);
  if (m.target.fuzz) m.angle += spread(game, 21);       // 투명한 상대는 조준이 흔들림
};

export const ACTIONS = {
  /** 서 있는 상태: 소리를 듣거나 플레이어를 보면 쫓기 시작 */
  look(m, game) {
    m.threshold = 0;
    let found = false;
    const targ = m.sector.soundTarget;
    if (targ && targ.shootable) {
      m.target = targ;
      if (m.ambush) { if (checkSight(game, m, targ)) found = true; } else found = true;
    }
    if (!found && !lookForPlayers(game, m, false)) return;
    say(game, m, 'see');
    m.setState('run', game);
  },

  /** 쫓는 상태: 근접/원거리 공격을 고르거나 한 걸음 이동 */
  chase(m, game) {
    if (m.reaction) m.reaction--;
    if (m.threshold) { if (!m.target || !m.target.shootable) m.threshold = 0; else m.threshold--; }

    // 이동 방향으로 몸을 돌린다 (45° 씩)
    if (m.moveDir < 8) {
      const snapped = Math.floor(m.angle / (Math.PI / 4) + 1e-9) * (Math.PI / 4);
      const delta = normAngle(snapped - m.moveDir * (Math.PI / 4));
      m.angle = delta > 1e-6 ? snapped - Math.PI / 4 : delta < -1e-6 ? snapped + Math.PI / 4 : snapped;
    }

    if (!m.target || !m.target.shootable) {
      if (lookForPlayers(game, m, true)) return;
      m.setState('stand', game);
      return;
    }
    if (m.justAttacked) { m.justAttacked = false; newChaseDir(game, m); return; } // 연속 공격 금지

    if (m.ai.melee && checkMeleeRange(game, m)) { say(game, m, 'melee'); m.setState(m.ai.melee, game); return; }

    if (m.ai.missile && !m.moveCount && checkMissileRange(game, m)) {
      m.setState(m.ai.missile, game);
      m.justAttacked = true;
      return;
    }

    if (--m.moveCount < 0 || !move(game, m)) newChaseDir(game, m);
    if (game.rnd() < 3) say(game, m, 'active');   // 가끔 으르렁
  },

  faceTarget,

  posAttack(m, game) {
    say(game, m, 'attack');
    faceTarget(m, game);
    const aim = aimLineAttack(game, m, m.angle, MISSILE_RANGE);
    lineAttack(game, m, m.angle + spread(game, 20), MISSILE_RANGE, aim ? aim.slope : 0, ((game.rnd() % 5) + 1) * 3);
  },

  sposAttack(m, game) {
    say(game, m, 'attack');
    faceTarget(m, game);
    const aim = aimLineAttack(game, m, m.angle, MISSILE_RANGE);
    for (let i = 0; i < 3; i++) {
      lineAttack(game, m, m.angle + spread(game, 20), MISSILE_RANGE, aim ? aim.slope : 0, ((game.rnd() % 5) + 1) * 3);
    }
  },

  troopAttack(m, game) {
    faceTarget(m, game);
    if (checkMeleeRange(game, m)) { damageMobj(game, m.target, m, m, ((game.rnd() % 8) + 1) * 3); return; }
    spawnMissile(game, m, m.target, 'troopShot');
  },

  sargAttack(m, game) {
    faceTarget(m, game);
    if (checkMeleeRange(game, m)) damageMobj(game, m.target, m, m, ((game.rnd() % 10) + 1) * 4);
  },

  bruisAttack(m, game) {
    if (!m.target) return;
    if (checkMeleeRange(game, m)) { damageMobj(game, m.target, m, m, ((game.rnd() % 8) + 1) * 10); return; }
    spawnMissile(game, m, m.target, 'bruiserShot');
  },

  headAttack(m, game) {
    if (!m.target) return;
    faceTarget(m, game);
    if (checkMeleeRange(game, m)) { damageMobj(game, m.target, m, m, ((game.rnd() % 6) + 1) * 10); return; }
    spawnMissile(game, m, m.target, 'headShot');
  },

  /** 로스트 소울: 대상을 향해 속도 20 으로 돌진 (부딪히면 skullMove 가 멈춘다) */
  skullAttack(m, game) {
    const t = m.target;
    if (!t) return;
    m.skullFly = true;
    say(game, m, 'attack');
    faceTarget(m, game);
    m.momx = SKULL_SPEED * Math.cos(m.angle); m.momy = SKULL_SPEED * Math.sin(m.angle);
    const tics = Math.max(1, approxDist(t.x - m.x, t.y - m.y) / SKULL_SPEED);
    m.momz = (t.z + t.height / 2 - m.z) / tics;
  },

  cyberAttack(m, game) {
    if (!m.target) return;
    faceTarget(m, game);
    spawnMissile(game, m, m.target, 'rocket');
  },

  /** 발소리 + 쫓기 (사이버데몬 발굽, 스파이더·사이버데몬 쇳소리) */
  hoof(m, game) { game.playSound('HOOF', m); ACTIONS.chase(m, game); },
  metal(m, game) { game.playSound('METAL', m); ACTIONS.chase(m, game); },

  /** 스파이더: 대상이 안 보이거나 죽었으면 쏘기를 멈춘다 (가끔은 그래도 계속) */
  spidRefire(m, game) {
    faceTarget(m, game);
    if (game.rnd() < 10) return;
    if (!m.target || m.target.health <= 0 || !checkSight(game, m, m.target)) m.setState('run', game);
  },

  /** BFG 공이 터질 때: 쏜 사람 위치에서 공이 날아간 방향 ±45° 로 광선 40 줄, 맞은 것마다 15d8 */
  bfgSpray(m, game) {
    const owner = m.owner;
    if (!owner) return;
    for (let i = 0; i < 40; i++) {
      const an = m.angle - Math.PI / 4 + (Math.PI / 2 / 40) * i;
      const aim = aimLineAttack(game, owner, an, 16 * 64);
      if (!aim) continue;
      const t = aim.target;
      game.spawnKind('bfgHit', t.x, t.y, t.z + t.height / 4);
      let damage = 0;
      for (let j = 0; j < 15; j++) damage += (game.rnd() & 7) + 1;
      damageMobj(game, t, owner, owner, damage);
    }
  },

  pain(m, game) { say(game, m, 'pain'); },
  scream(m, game) { say(game, m, 'die'); },
  xscream(m, game) { say(game, m, 'xdie'); },

  /** 쓰러지는 순간부터 통과할 수 있다 */
  fall(m, game) { game.setSolid(m, false); },

  /** 폭발 (통, 로켓): 반경 128 안에 거리에 따라 약해지는 데미지 */
  explode(m, game) { radiusAttack(game, m, m.target, 128); },

  /** 보스 맵: 그 맵의 보스가 모두 죽으면 바닥이 내려가거나(태그 666) 문이 열리거나 바로 맵이 끝난다 (원작 A_BossDeath) */
  bossDeath(m, game) {
    const boss = BOSS_MAPS[game.level.name]?.find((b) => b.type === m.type);
    if (!boss || game.player.dead) return;
    if (game.mobjs.some((o) => o.type === boss.type && o !== m && o.health > 0)) return;
    if (boss.then === 'floor') game.specials.doFloor({ tag: 666 }, 'lowerFloorToLowest');
    else if (boss.then === 'texture') game.specials.doFloor({ tag: 667 }, 'raiseToTexture');
    else if (boss.then === 'door') game.specials.doDoor({ tag: 666 }, 'blazeOpen');
    else game.exitLevel(false);
  },

  // ================= 둠2 =================
  /** 체인거너·SS: 한 발씩 (소리는 샷건) */
  cposAttack(m, game) {
    if (!m.target) return;
    game.playSound('SHOTGN', m);
    faceTarget(m, game);
    const aim = aimLineAttack(game, m, m.angle, MISSILE_RANGE);
    lineAttack(game, m, m.angle + spread(game, 20), MISSILE_RANGE, aim ? aim.slope : 0, ((game.rnd() % 5) + 1) * 3);
  },
  /** 대상이 안 보이거나 죽었으면 연사를 멈춘다 */
  cposRefire(m, game) {
    faceTarget(m, game);
    if (game.rnd() < 40) return;
    if (!m.target || m.target.health <= 0 || !checkSight(game, m, m.target)) m.setState('run', game);
  },

  skelWhoosh(m, game) { if (!m.target) return; faceTarget(m, game); game.playSound('SKESWG', m); },
  skelFist(m, game) {
    if (!m.target) return;
    faceTarget(m, game);
    if (checkMeleeRange(game, m)) { game.playSound('SKEPCH', m); damageMobj(game, m.target, m, m, ((game.rnd() % 10) + 1) * 6); }
  },
  /** 레버넌트 미사일: 조금 높은 곳에서 쏘고, 대상을 따라간다 (tracer) */
  skelMissile(m, game) {
    if (!m.target) return;
    faceTarget(m, game);
    m.z += 16;
    const mo = spawnMissile(game, m, m.target, 'tracer');
    m.z -= 16;
    mo.x += mo.momx; mo.y += mo.momy;
    mo.tracer = m.target;
  },
  /** 유도: 4 tic 마다 연기를 남기고 대상 쪽으로 최대 17° 꺾는다 */
  tracer(m, game) {
    if (game.time & 3) return;
    spawnPuff(game, m.x, m.y, m.z);
    const smoke = game.spawnKind('smoke', m.x - m.momx, m.y - m.momy, m.z);
    smoke.momz = 1; smoke.tics = Math.max(1, smoke.tics - (game.rnd() & 3));
    const t = m.tracer;
    if (!t || t.health <= 0) return;
    const exact = Math.atan2(t.y - m.y, t.x - m.x), diff = normAngle(exact - m.angle);
    m.angle = Math.abs(diff) <= TRACE_ANGLE ? exact : m.angle + Math.sign(diff) * TRACE_ANGLE;
    const speed = m.ai.missile.speed;
    m.momx = speed * Math.cos(m.angle); m.momy = speed * Math.sin(m.angle);
    const dist = Math.max(1, approxDist(t.x - m.x, t.y - m.y) / speed);
    const slope = (t.z + 40 - m.z) / dist;
    m.momz += slope < m.momz ? -1 / 8 : 1 / 8;
  },

  fatRaise(m, game) { faceTarget(m, game); game.playSound('MANATK', m); },
  /** 맨큐버스 세 번의 사격: 대상 쪽 한 발 + 옆으로 벌어진 한 발 */
  fatAttack1(m, game) { fatPair(m, game, FAT_SPREAD, 0, FAT_SPREAD); },
  fatAttack2(m, game) { fatPair(m, game, -FAT_SPREAD, 0, -FAT_SPREAD * 2); },
  fatAttack3(m, game) { fatPair(m, game, 0, -FAT_SPREAD / 2, FAT_SPREAD / 2); },

  babyMetal(m, game) { game.playSound('BSPWLK', m); ACTIONS.chase(m, game); },
  bspiAttack(m, game) { if (!m.target) return; faceTarget(m, game); spawnMissile(game, m, m.target, 'arachPlaz'); },

  painAttack(m, game) { if (!m.target) return; faceTarget(m, game); painShootSkull(game, m, m.angle); },
  painDie(m, game) {
    ACTIONS.fall(m, game);
    for (const turn of [1, 2, 3]) painShootSkull(game, m, m.angle + (turn * Math.PI) / 2);
  },

  /** 아크바일: 걸어가는 앞쪽에 되살릴 시체가 있으면 되살리고, 없으면 보통 추적 */
  vileChase(m, game) {
    if (m.moveDir !== DI_NODIR) {
      const tx = m.x + m.ai.speed * XSPEED[m.moveDir], ty = m.y + m.ai.speed * YSPEED[m.moveDir];
      for (const c of game.mobjs) {
        if (!c.corpse || c.removed || c.tics !== -1 || !c.ai?.states.raise) continue;
        if (Math.abs(c.x - tx) > c.info.radius + m.radius || Math.abs(c.y - ty) > c.info.radius + m.radius) continue;
        if (game.physics.check(c.x, c.y, c.z, c.info.height, c.info.radius, { ignore: c, monster: true }).blocked) continue;
        const keep = m.target;
        m.target = c; faceTarget(m, game); m.target = keep;
        m.setState('heal', game);
        game.playSound('SLOP', c);
        raiseCorpse(game, c);
        return;
      }
    }
    ACTIONS.chase(m, game);
  },
  vileStart(m, game) { game.playSound('VILATK', m); },
  /** 대상 앞에 불기둥을 세운다 (불기둥은 대상을 따라다닌다) */
  vileTarget(m, game) {
    const t = m.target;
    if (!t) return;
    faceTarget(m, game);
    const fire = game.spawnKind('vileFire', t.x, t.y, t.z);
    fire.owner = m; fire.tracer = t;
    m.tracer = fire;
    ACTIONS.fire(fire, game);
  },
  /** 보이면 20 피해 + 공중으로 띄우고, 불기둥 자리에서 폭발 70 */
  vileAttack(m, game) {
    const t = m.target;
    if (!t) return;
    faceTarget(m, game);
    if (!checkSight(game, m, t)) return;
    game.playSound('BAREXP', t);
    damageMobj(game, t, m, m, 20);
    t.momz = 1000 / (t.mass ?? t.ai?.mass ?? 100);
    const fire = m.tracer;
    if (!fire || fire.removed) return;
    fire.x = t.x - 24 * Math.cos(m.angle); fire.y = t.y - 24 * Math.sin(m.angle);
    radiusAttack(game, fire, m, 70);
  },
  startFire(m, game) { game.playSound('FLAMST', m); ACTIONS.fire(m, game); },
  fireCrackle(m, game) { game.playSound('FLAME', m); ACTIONS.fire(m, game); },
  /** 불기둥: 아크바일이 대상을 보는 동안 대상 바로 앞에 붙어 있다 */
  fire(m, game) {
    const t = m.tracer, vile = m.owner;
    if (!t || !vile || !checkSight(game, vile, t)) return;
    m.x = t.x + 24 * Math.cos(t.angle); m.y = t.y + 24 * Math.sin(t.angle); m.z = t.z;
    m.sector = sectorAt(game.level, m.x, m.y);
  },

  /** 커맨더 킨이 모두 죽으면 태그 666 문이 열린다 */
  keenDie(m, game) {
    ACTIONS.fall(m, game);
    if (game.mobjs.some((o) => o.type === m.type && o !== m && o.health > 0)) return;
    game.specials.doDoor({ tag: 666 }, 'open');
  },

  // ---------- 아이콘 오브 신 ----------
  brainPain(m, game) { game.playSound('BOSPN'); },
  /** 뇌가 죽으면 사방에서 폭발 (그림만) */
  brainScream(m, game) {
    for (let x = m.x - 196; x < m.x + 320; x += 8) {
      const y = m.y - 320, z = 128 + game.rnd() * 2;
      const boom = game.spawnKind('brainBoom', x, y, z);
      boom.tics = Math.max(1, boom.tics - (game.rnd() & 7));
    }
    game.playSound('BOSDTH');
  },
  brainDie(m, game) { game.exitLevel(false); },
  /** 눈이 깨어나면 큐브가 날아갈 목표 지점(thing 87)을 모은다 */
  brainAwake(m, game) {
    game.brainTargets = game.level.things.filter((t) => t.type === 87).map((t) => ({ x: t.x, y: t.y, sector: sectorAt(game.level, t.x, t.y) }));
    game.brainTargetOn = 0;
    game.playSound('BOSSIT');
  },
  /** 목표 지점을 돌아가며 큐브를 쏜다 (쉬움 난이도에서는 두 번에 한 번) */
  brainSpit(m, game) {
    if (!game.brainTargets) ACTIONS.brainAwake(m, game);
    const targets = game.brainTargets;
    if (!targets.length) return;
    game.brainEasy = !game.brainEasy;
    if (game.skill <= 2 && !game.brainEasy) return;
    const t = targets[game.brainTargetOn++ % targets.length];
    const dest = { x: t.x, y: t.y, z: t.sector.floorHeight };
    const cube = spawnMissile(game, m, dest, 'spawnCube');
    cube.target = null; cube.dest = dest;
    // 목표까지 걸리는 상태 수 (상태 하나 = 3 tic)
    cube.reaction = Math.max(1, Math.floor(approxDist(t.x - m.x, t.y - m.y) / cube.speed / 3));
    game.playSound('BOSPIT');
  },
  spawnSound(m, game) { game.playSound('BOSCUB', m); ACTIONS.spawnFly(m, game); },
  /** 큐브가 목표에 닿으면 불꽃과 함께 무작위 몬스터가 나타난다 (그 자리에 있던 것은 밟혀 죽는다) */
  spawnFly(m, game) {
    if (--m.reaction > 0) return;
    const d = m.dest ?? m;
    game.spawnKind('spawnFire', d.x, d.y, d.z);
    game.playSound('TELEPT', d);
    const r = game.rnd(), type = CUBE_SPAWNS.find(([limit]) => r < limit)[1];
    const sec = sectorAt(game.level, d.x, d.y);
    const mon = new Mobj(type, THING_INFO[type], d.x, d.y, 0, sec);
    game.addMobj(mon);
    if (lookForPlayers(game, mon, true)) { mon.reaction = 0; mon.setState('run', game); }
    for (const v of game.shootables) if (v !== mon && Math.abs(v.x - d.x) < v.radius + mon.radius && Math.abs(v.y - d.y) < v.radius + mon.radius) damageMobj(game, v, mon, mon, 10000);
    game.removeMobj(m);
  },
};

// ---------- 투사체 ----------
/** source 가 dest 를 향해 kind(불덩이 등)를 쏜다 */
export function spawnMissile(game, source, dest, kind) {
  const m = game.spawnKind(kind, source.x, source.y, source.z + 32);
  if (game.skill === 5 && m.speed < 20) m.speed = 20;   // 악몽: 불덩이가 빠르다
  m.owner = source; m.target = source;
  let ang = Math.atan2(dest.y - source.y, dest.x - source.x);
  if (dest.fuzz) ang += spread(game, 20);
  m.angle = ang;
  m.momx = m.speed * Math.cos(ang); m.momy = m.speed * Math.sin(ang);
  const flightTics = Math.max(1, approxDist(dest.x - source.x, dest.y - source.y) / m.speed);
  m.momz = (dest.z - source.z) / flightTics;
  startMissile(game, m);
  return m;
}

/** 쏜 직후 반 걸음 앞으로 내보내고, 그 자리가 막혔으면 바로 터진다 */
export function startMissile(game, m) {
  if (m.ai.missile.sound) game.playSound(m.ai.missile.sound, m);
  m.tics -= game.rnd() & 3;
  if (m.tics < 1) m.tics = 1;
  m.x += m.momx / 2; m.y += m.momy / 2; m.z += m.momz / 2;
  m.sector = sectorAt(game.level, m.x, m.y);
  if (!m.ai.noClip && missileBlocked(game, m, m.x, m.y)) explodeMissile(game, m);
}

export function explodeMissile(game, m) {
  game.playSound(m.ai.missile.deathSound, m);
  m.momx = m.momy = m.momz = 0;
  m.missile = false;
  if (m.ai.dieSprite) m.sprite = m.ai.dieSprite;   // 플라즈마·BFG 는 터지는 그림이 따로 있다
  m.setState('die', game);
  m.tics -= game.rnd() & 3;
  if (m.tics < 1) m.tics = 1;
}

/** 투사체가 (x,y)에서 물체에 맞았는가(맞으면 데미지 후 true) 또는 벽에 막혔는가 */
function missileBlocked(game, m, x, y) {
  const owner = m.owner;
  const victims = game.player.shootable ? [...game.shootables, game.player] : game.shootables;
  for (const t of victims) {
    if (t === owner) continue;
    if (Math.abs(t.x - x) >= t.radius + m.radius || Math.abs(t.y - y) >= t.radius + m.radius) continue;
    if (m.z > t.z + t.height || m.z + m.height < t.z) continue;      // 위/아래로 지나감
    if (owner && owner.type === t.type && !t.isPlayer) return true;   // 같은 종족끼리는 터지기만 한다
    damageMobj(game, t, m, owner, ((game.rnd() % 8) + 1) * m.damageScale);
    return true;
  }
  const r = game.physics.check(x, y, m.z, m.height, m.radius, { ignore: m, missile: true });
  m.floorz = r.floorz; m.ceilz = r.ceilz;
  return r.blocked;
}

function moveMissile(game, m) {
  let hit = false;
  splitMove(m.momx, m.momy, MAXMOVE / 2, (px, py) => {
    const nx = m.x + px, ny = m.y + py;
    if (missileBlocked(game, m, nx, ny)) {
      // 하늘이 보이는 천장에 부딪히면 터지지 않고 사라진다
      if (m.ceilz <= m.z + m.height && sectorAt(game.level, nx, ny).ceilingTex === 'F_SKY1') game.removeMobj(m);
      else explodeMissile(game, m);
      hit = true;
      return false;
    }
    m.x = nx; m.y = ny;
    m.sector = sectorAt(game.level, nx, ny);
  });
  if (hit) return;

  m.z += m.momz;
  if (m.z <= m.floorz) { m.z = m.floorz; explodeMissile(game, m); }
  else if (m.z + m.height > m.ceilz) {
    if (m.sector.ceilingTex === 'F_SKY1') game.removeMobj(m); else explodeMissile(game, m);
  }
}

// ---------- 악몽 난이도: 시체가 원래 자리에서 되살아난다 (원작 P_NightmareRespawn) ----------
const RESPAWN_AFTER = 12 * 35;   // 쓰러진 뒤 최소 12초

/** 시체 m 을 매 tic 부른다: 12초가 지나면 32tic 마다 약 2% 확률로, 자리가 비어 있을 때 부활 */
export function nightmareRespawn(game, m) {
  if (++m.moveCount < RESPAWN_AFTER || (game.time & 31) || game.rnd() > 4) return;
  const { spawnX: x, spawnY: y } = m, sec = sectorAt(game.level, x, y);
  if (game.physics.check(x, y, sec.floorHeight, m.info.height, m.info.radius, { monster: true }).blocked) return;   // 누가 서 있다

  game.spawnKind('tfog', m.x, m.y, m.z);
  game.playSound('TELEPT', m);
  const reborn = new Mobj(m.type, m.info, x, y, m.spawnAngle, sec);
  reborn.spawnAmbush = reborn.ambush = m.spawnAmbush;
  reborn.reaction = 18;
  game.addMobj(reborn);
  game.spawnKind('tfog', x, y, sec.floorHeight);
  game.playSound('TELEPT', reborn);
  game.removeMobj(m);
}

// ---------- 매 tic 이동 (몬스터, 시체, 투사체, 효과) ----------
export function moveMobj(game, m) {
  if (m.ai.noClip) { m.x += m.momx; m.y += m.momy; m.z += m.momz; m.sector = sectorAt(game.level, m.x, m.y); return; }   // 큐브: 벽을 뚫고 간다
  if (m.missile) { moveMissile(game, m); return; }

  if (m.ai.effect) {                    // 먼지/피: 위로 떠올랐다가 (피는) 떨어진다
    m.z += m.momz;
    if (m.ai.rise === 2) { m.momz -= GRAVITY; if (m.z < m.sector.floorHeight) { m.z = m.sector.floorHeight; m.momz = 0; } }
    return;
  }

  if (m.skullFly) { skullMove(game, m); return; }
  if (m.momx || m.momy) xyMove(game, m);
  if (m.floating) floatZMove(game, m);
  else if (!m.ai.noGravity) zMove(game, m);   // 로스트 소울 시체·커맨더 킨은 그 자리에
}

/** 맨큐버스: 몸을 turn 만큼 돌리고 대상 쪽으로 한 발(+a1), 그 옆으로 한 발(+a2) */
function fatPair(m, game, turn, a1, a2) {
  if (!m.target) return;
  faceTarget(m, game);
  m.angle += turn;
  for (const extra of [a1, a2]) {
    const mo = spawnMissile(game, m, m.target, 'fatShot');
    mo.angle += extra;
    mo.momx = mo.speed * Math.cos(mo.angle); mo.momy = mo.speed * Math.sin(mo.angle);
  }
}

/** 페인 엘리멘탈이 angle 쪽으로 로스트 소울을 뱉는다. 자리가 막혀 있으면 바로 터진다 */
function painShootSkull(game, m, angle) {
  if (game.mobjs.filter((o) => o.type === 3006 && !o.removed).length > MAX_SKULLS) return;
  const info = THING_INFO[3006], prestep = 4 + (3 * (m.ai ? m.radius + info.radius : 0)) / 2;
  const x = m.x + prestep * Math.cos(angle), y = m.y + prestep * Math.sin(angle);
  const skull = new Mobj(3006, info, x, y, angle, sectorAt(game.level, x, y));
  skull.z = m.z + 8;
  game.addMobj(skull);
  if (game.physics.check(x, y, skull.z, skull.height, skull.radius, { ignore: skull, monster: true }).blocked) {
    damageMobj(game, skull, m, m, 10000);
    return;
  }
  skull.target = m.target;
  ACTIONS.skullAttack(skull, game);
}

/** 아크바일이 시체를 되살린다: 원래 키·체력·충돌로 돌아가 거꾸로 일어선다 */
function raiseCorpse(game, c) {
  c.corpse = false;
  c.sprite = c.info.sprite; c.radius = c.info.radius; c.height = c.info.height;   // 짓눌린 고깃덩이였어도 원래대로
  c.health = c.ai.hp; c.target = null; c.momx = c.momy = c.momz = 0;
  c.floating = !!c.ai.float;
  game.setSolid(c, !!c.info.solid);
  game.setShootable(c, true);
  c.setState('raise', game);
}

/** (x, y) 에서 m 과 부딪히는 다른 물체 (없으면 null) */
function thingAt(game, m, x, y) {
  const victims = game.player.shootable ? [...game.shootables, game.player] : game.shootables;
  for (const t of victims) {
    if (t === m) continue;
    if (Math.abs(t.x - x) >= t.radius + m.radius || Math.abs(t.y - y) >= t.radius + m.radius) continue;
    if (m.z > t.z + t.height || m.z + m.height < t.z) continue;
    return t;
  }
  return null;
}

/** 로스트 소울 돌진: 물체에 부딪히면 3d8 피해, 벽이든 물체든 부딪히면 멈추고 다시 떠다닌다 (마찰 없음) */
function skullMove(game, m) {
  let stop = false;
  splitMove(m.momx, m.momy, MAXMOVE / 2, (px, py) => {
    const nx = m.x + px, ny = m.y + py;
    const hit = thingAt(game, m, nx, ny);
    if (hit) { damageMobj(game, hit, m, m, ((game.rnd() % 8) + 1) * 3); stop = true; return false; }
    if (!tryMoveMobj(game, m, nx, ny)) { stop = true; return false; }
  });
  if (stop || (!m.momx && !m.momy)) {
    m.skullFly = false;
    m.momx = m.momy = m.momz = 0;
    if (!m.corpse) m.setState('stand', game);
    return;
  }
  floatZMove(game, m);
}

/** 떠다니는 몬스터의 높이: 대상의 높이 쪽으로 천천히 오르내린다. 바닥·천장에 닿으면 멈춤 (돌진 중이면 튕김) */
function floatZMove(game, m) {
  const r = game.physics.check(m.x, m.y, m.z, m.height, m.radius, { ignore: m, monster: true });
  m.floorz = r.floorz; m.ceilz = r.ceilz;
  const t = m.target;
  if (t && !m.skullFly && !m.corpse) {
    const dist = approxDist(t.x - m.x, t.y - m.y), delta = t.z + m.height / 2 - m.z;
    if (delta < 0 && dist < -delta * 3) m.z -= FLOAT_SPEED;
    else if (delta > 0 && dist < delta * 3) m.z += FLOAT_SPEED;
  }
  m.z += m.momz;
  if (m.z <= m.floorz) { m.z = m.floorz; m.momz = m.skullFly ? -m.momz : 0; }
  if (m.z + m.height > m.ceilz) { m.z = Math.max(m.floorz, m.ceilz - m.height); m.momz = m.skullFly ? -m.momz : 0; }
}

function xyMove(game, m) {
  m.momx = Math.max(-MAXMOVE, Math.min(MAXMOVE, m.momx));
  m.momy = Math.max(-MAXMOVE, Math.min(MAXMOVE, m.momy));
  splitMove(m.momx, m.momy, MAXMOVE / 2, (px, py) => {
    if (!tryMoveMobj(game, m, m.x + px, m.y + py)) { m.momx = m.momy = 0; return false; }  // 막히면 멈춤
  });

  if (m.z > m.floorz) return;                                    // 공중에서는 마찰 없음
  if (Math.abs(m.momx) < STOPSPEED && Math.abs(m.momy) < STOPSPEED) { m.momx = m.momy = 0; }
  else { m.momx *= FRICTION; m.momy *= FRICTION; }
}

function zMove(game, m) {
  if (m.z === m.floorz && !m.momz && m.floorz === m.sector.floorHeight && !m.sector.specialData) return;
  const r = game.physics.check(m.x, m.y, m.z, m.height, m.radius, { ignore: m, monster: true });
  m.floorz = r.floorz; m.ceilz = r.ceilz;
  if (m.z < m.floorz) { m.z = m.floorz; m.momz = 0; return; }   // 바닥이 올라오면 같이 올라간다
  if (m.z === m.floorz) return;
  m.momz = m.momz === 0 ? -GRAVITY * 2 : m.momz - GRAVITY;       // 공중: 중력
  m.z += m.momz;
  if (m.z <= m.floorz) { m.z = m.floorz; m.momz = 0; }
}

import { sectorAt } from '../render/bsp.js';
import { GRAVITY, MAXMOVE, STOPSPEED, FRICTION } from './physics.js';
import { normAngle, spread, splitMove } from './util.js';
import { Mobj } from './mobj.js';
import {
  MELEE_RANGE, MISSILE_RANGE, approxDist, checkSight, aimLineAttack, lineAttack, damageMobj, radiusAttack,
} from './combat.js';

/**
 * 몬스터 AI (원작 p_enemy.c 의 A_Look / A_Chase / 공격 동작)와 물체 이동(p_mobj.c).
 * 몬스터의 상태 진행은 Mobj(states.js 의 표)가 하고, 여기는 "들어갈 때 실행되는 동작"과 이동 규칙을 둔다.
 */
const DI_NODIR = 8;
const XSPEED = [1, 0.717, 0, -0.717, -1, -0.717, 0, 0.717];  // 8방향 이동 단위 (E, NE, N, NW, W, SW, S, SE)
const YSPEED = [0, 0.717, 1, 0.717, 0, -0.717, -1, -0.717];
const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3, DI_NODIR];
const DIAGS = [3, 1, 5, 7]; // [(dy<0)<<1 + (dx>0)] → NW, NE, SW, SE

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
  return game.physics.tryMove(m, nx, ny, { ignore: m, monster: true, dropoff: m.corpse });
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
    if (good) m.moveDir = DI_NODIR;
    return good;
  }
  game.specials.crossLines(m, ox, oy);   // 텔레포트 선 · 문 · 리프트 선을 밟았으면 작동 (텔레포트하면 floorz 도 새 자리 것)
  m.z = m.floorz;
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
  dist = Math.min(200, Math.floor(dist));
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

  pain(m, game) { say(game, m, 'pain'); },
  scream(m, game) { say(game, m, 'die'); },
  xscream(m, game) { say(game, m, 'xdie'); },

  /** 쓰러지는 순간부터 통과할 수 있다 */
  fall(m, game) { game.setSolid(m, false); },

  /** 폭발 (통, 로켓): 반경 128 안에 거리에 따라 약해지는 데미지 */
  explode(m, game) { radiusAttack(game, m, m.target, 128); },

  /** E1M8: 바론이 모두 죽으면 출구 쪽 바닥(태그 666)이 내려간다 */
  bossDeath(m, game) {
    if (game.level.name !== 'E1M8') return;
    if (game.mobjs.some((o) => o.type === 3003 && o !== m && o.health > 0)) return;
    game.specials.doFloor({ tag: 666 }, 'lowerFloorToLowest');
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
  game.playSound(m.ai.missile.sound, m);
  m.tics -= game.rnd() & 3;
  if (m.tics < 1) m.tics = 1;
  m.x += m.momx / 2; m.y += m.momy / 2; m.z += m.momz / 2;
  m.sector = sectorAt(game.level, m.x, m.y);
  if (missileBlocked(game, m, m.x, m.y)) explodeMissile(game, m);
}

export function explodeMissile(game, m) {
  game.playSound(m.ai.missile.deathSound, m);
  m.momx = m.momy = m.momz = 0;
  m.missile = false;
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
  if (m.missile) { moveMissile(game, m); return; }

  if (m.ai.effect) {                    // 먼지/피: 위로 떠올랐다가 (피는) 떨어진다
    m.z += m.momz;
    if (m.ai.rise === 2) { m.momz -= GRAVITY; if (m.z < m.sector.floorHeight) { m.z = m.sector.floorHeight; m.momz = 0; } }
    return;
  }

  if (m.momx || m.momy) xyMove(game, m);
  zMove(game, m);
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

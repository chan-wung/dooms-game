import { Physics } from './physics.js';
import { LINE_FLAGS } from '../wad/level.js';
import { THING_INFO, countsKill } from './info.js';
import { Mobj } from './mobj.js';

/**
 * 전투 엔진 (원작 p_sight.c / p_map.c / p_inter.c 를 단순화).
 *  - 선분 추적: 블록맵에서 선을 모아 지나는 순서(frac)대로 정렬하고, 물체는 "선분이 반지름 안으로 지나가는가"로 판정
 *  - 시선 / 자동 조준 / 총알 / 폭발 / 데미지 / 사망 / 소음(몬스터 깨우기)
 * 좌표 단위는 맵 유닛, 각도는 라디안.
 */
export const MELEE_RANGE = 64;
export const MISSILE_RANGE = 32 * 64;
const SLOPE_LIMIT = 100 / 160; // 화면 위아래 한계 (원작 자동 조준 범위)

export const approxDist = (dx, dy) => {
  dx = Math.abs(dx); dy = Math.abs(dy);
  return dx < dy ? dx + dy - dx / 2 : dx + dy - dy / 2;
};

/** 선분 (x1,y1)→(x2,y2) 이 지나는 선들과 물체들을 지나는 순서대로 돌려준다 */
export function trace(game, x1, y1, x2, y2, self = null, withThings = true) {
  const list = [];
  game.blockmap.forEachLine(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), (ld) => {
    const t = Physics.intersect(ld, x1, y1, x2, y2);
    if (t >= 0) list.push({ frac: t, line: ld });
  });
  if (withThings) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    if (len2 > 0) {
      const consider = (t) => {
        if (t === self || !t.shootable) return;
        const cx = t.x - x1, cy = t.y - y1;
        const f = (cx * dx + cy * dy) / len2;
        const perp = Math.abs(cx * dy - cy * dx) / len;
        if (perp > t.radius) return;
        const entry = Math.max(0, f - Math.sqrt(t.radius * t.radius - perp * perp) / len); // 반지름 앞쪽에서 들어간다
        if (entry > 1 || f < 0) return;
        list.push({ frac: entry, thing: t });
      };
      for (const t of game.shootables) consider(t);
      consider(game.player);
    }
  }
  return list.sort((a, b) => a.frac - b.frac);
}

/** a 가 b 를 볼 수 있는가 (벽/닫힌 문/높이 차로 가려지지 않는가) */
export function checkSight(game, a, b) {
  const zStart = a.z + a.height * 0.75;
  let top = b.z + b.height - zStart, bottom = b.z - zStart;
  for (const it of trace(game, a.x, a.y, b.x, b.y, null, false)) {
    const ld = it.line;
    if (!ld.backSector) return false;
    const f = ld.frontSector, k = ld.backSector;
    const openTop = Math.min(f.ceilingHeight, k.ceilingHeight), openBottom = Math.max(f.floorHeight, k.floorHeight);
    if (openBottom >= openTop) return false;               // 닫힌 문
    const frac = Math.max(it.frac, 1e-4);
    if (f.floorHeight !== k.floorHeight) { const s = (openBottom - zStart) / frac; if (s > bottom) bottom = s; }
    if (f.ceilingHeight !== k.ceilingHeight) { const s = (openTop - zStart) / frac; if (s < top) top = s; }
    if (top <= bottom) return false;
  }
  return true;
}

const shootZ = (t) => t.z + t.height / 2 + 8;

/** 자동 조준: angle 방향으로 range 안에서 조준선이 걸리는 첫 목표. { target, slope } 또는 null */
export function aimLineAttack(game, shooter, angle, range) {
  const x1 = shooter.x, y1 = shooter.y, z0 = shootZ(shooter);
  const x2 = x1 + Math.cos(angle) * range, y2 = y1 + Math.sin(angle) * range;
  let top = SLOPE_LIMIT, bottom = -SLOPE_LIMIT;
  for (const it of trace(game, x1, y1, x2, y2, shooter)) {
    const dist = Math.max(range * it.frac, 1);
    if (it.line) {
      const ld = it.line;
      if (!ld.backSector) return null;
      const f = ld.frontSector, k = ld.backSector;
      const openTop = Math.min(f.ceilingHeight, k.ceilingHeight), openBottom = Math.max(f.floorHeight, k.floorHeight);
      if (openTop <= openBottom) return null;
      if (f.floorHeight !== k.floorHeight) { const s = (openBottom - z0) / dist; if (s > bottom) bottom = s; }
      if (f.ceilingHeight !== k.ceilingHeight) { const s = (openTop - z0) / dist; if (s < top) top = s; }
      if (top <= bottom) return null;
    } else {
      const th = it.thing;
      const tTop = (th.z + th.height - z0) / dist, tBottom = (th.z - z0) / dist;
      if (tTop < bottom || tBottom > top) continue;       // 위로 지나가거나 아래로 지나감
      return { target: th, slope: (Math.min(tTop, top) + Math.max(tBottom, bottom)) / 2 };
    }
  }
  return null;
}

/** 히트스캔 한 발: 벽에 맞으면 먼지, 물체에 맞으면 피(또는 먼지)와 데미지. 맞은 물체(없으면 null) */
export function lineAttack(game, shooter, angle, range, slope, damage) {
  const x1 = shooter.x, y1 = shooter.y, z0 = shootZ(shooter);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const x2 = x1 + cos * range, y2 = y1 + sin * range;

  const puffAt = (frac) => {
    const f = Math.max(0, frac - 4 / range);
    spawnPuff(game, x1 + cos * range * f, y1 + sin * range * f, z0 + slope * range * f);
  };

  for (const it of trace(game, x1, y1, x2, y2, shooter)) {
    const dist = Math.max(range * it.frac, 1);
    if (it.line) {
      const ld = it.line;
      if (ld.special && shooter.isPlayer) game.specials.shootLine(ld, shooter);
      if (!ld.backSector) { puffAt(it.frac); return null; }
      const f = ld.frontSector, k = ld.backSector;
      const openTop = Math.min(f.ceilingHeight, k.ceilingHeight), openBottom = Math.max(f.floorHeight, k.floorHeight);
      if ((f.floorHeight !== k.floorHeight && (openBottom - z0) / dist > slope)
        || (f.ceilingHeight !== k.ceilingHeight && (openTop - z0) / dist < slope)
        || openTop <= openBottom) {
        if (f.ceilingTex === 'F_SKY1' && k.ceilingTex === 'F_SKY1') return null; // 하늘로 날아감: 흔적 없음
        puffAt(it.frac); return null;
      }
    } else {
      const th = it.thing;
      if (th === shooter) continue;
      const tTop = (th.z + th.height - z0) / dist, tBottom = (th.z - z0) / dist;
      if (tTop < slope || tBottom > slope) continue;       // 위/아래로 빗나감
      const f = Math.max(0, it.frac - 10 / range);
      const hx = x1 + cos * range * f, hy = y1 + sin * range * f, hz = z0 + slope * range * f;
      if (th.isPlayer || !th.ai?.noBlood) spawnBlood(game, hx, hy, hz, damage); else spawnPuff(game, hx, hy, hz);
      damageMobj(game, th, shooter, shooter, damage);
      return th;
    }
  }
  return null;
}

// ---------- 효과 ----------
function spawnEffect(game, kind, x, y, z, momz) {
  const m = game.spawnKind(kind, x, y, z);
  m.momz = momz;
  m.tics -= game.rnd() & 3;
  if (m.tics < 1) m.tics = 1;
  return m;
}

export function spawnPuff(game, x, y, z) {
  return spawnEffect(game, 'puff', x, y, z + (game.rnd() - game.rnd()) / 64, 1);
}

export function spawnBlood(game, x, y, z, damage) {
  const m = spawnEffect(game, 'blood', x, y, z + (game.rnd() - game.rnd()) / 64, 2);
  // 약한 공격일수록 작은 핏방울부터 시작
  if (damage <= 12 && damage >= 9) m.setStateNoAction('fly2');
  else if (damage < 9) m.setStateNoAction('fly3');
  return m;
}

// ---------- 데미지 / 사망 ----------
/** target 에게 damage 를 입힌다. inflictor = 때린 것(총알이면 쏜 사람, 불덩이면 불덩이), source = 책임자 */
export function damageMobj(game, target, inflictor, source, damage) {
  if (!target.shootable || damage <= 0) return;

  // 밀려남 (전기톱은 밀지 않음)
  if (inflictor && !(source?.isPlayer && source.readyWeapon === 'chainsaw')) {
    let ang = Math.atan2(target.y - inflictor.y, target.x - inflictor.x);
    let thrust = (damage * 0.125 * 100) / (target.mass ?? target.ai?.mass ?? 100);
    // 가끔 앞으로 쓰러지게 (원작의 장난)
    if (damage < 40 && damage > target.health && target.z - inflictor.z > 64 && (game.rnd() & 1)) { ang += Math.PI; thrust *= 4; }
    target.momx += thrust * Math.cos(ang);
    target.momy += thrust * Math.sin(ang);
  }

  if (target.isPlayer) { target.damage(damage, game, source); return; }

  target.health -= damage;
  if (target.health <= 0) { killMobj(game, source, target); return; }

  if (game.rnd() < target.ai.painChance && target.ai.painState) {
    target.justHit = true;                                  // 맞으면 반격하러 간다
    target.setState(target.ai.painState, game);
  }
  target.reaction = 0;                                      // 이제 깨어났다
  if (!target.threshold && source && source !== target) {
    target.target = source;                                 // 때린 쪽을 쫓는다 (통은 폭발의 책임자로 기억)
    target.threshold = 100;
    if (target.is('stand') && target.ai.states.run) target.setState('run', game);
  }
}

export function killMobj(game, source, target) {
  game.setShootable(target, false);
  target.missile = false;
  target.corpse = true;
  target.height = target.height / 4;
  target.floating = false; target.skullFly = false;   // 떠다니던 것도 떨어진다
  if (source?.isPlayer && countsKill(target.info)) game.killsFound++;

  const xdie = target.ai.states.xdie && target.health < -target.ai.hp;
  target.setState(xdie ? 'xdie' : 'die', game);
  target.tics -= game.rnd() & 3;
  if (target.tics < 1) target.tics = 1;

  // 떨어뜨리는 물건 (좀비맨·SS = 탄창, 샷건맨 = 샷건, 체인거너 = 체인건)
  const drop = { clip: 2007, shotgun: 2001, chaingun: 2002 }[target.ai.drop];
  if (drop) {
    const item = new Mobj(drop, THING_INFO[drop], target.x, target.y, 0, target.sector);
    item.dropped = true;
    game.addMobj(item);
  }
}

/** 폭발 범위 공격: spot 을 중심으로 damage 만큼, 멀수록 약하게 (시선이 막히면 안 맞음) */
export function radiusAttack(game, spot, source, damage) {
  const victims = [...game.shootables];
  if (game.player.shootable) victims.push(game.player);
  for (const t of victims) {
    if (t.ai?.noRadiusDamage) continue;                  // 사이버데몬·스파이더는 폭발에 맞지 않는다
    let dist = Math.max(Math.abs(t.x - spot.x), Math.abs(t.y - spot.y)) - t.radius;
    if (dist < 0) dist = 0;
    if (dist >= damage) continue;
    if (checkSight(game, t, spot)) damageMobj(game, t, spot, source, damage - dist);
  }
}

// ---------- 소음 ----------
/** 총소리: 같은 소리가 닿는 섹터의 몬스터가 깨어난다 (닫힌 문은 막고, 소리 차단선은 한 번만 통과) */
export function noiseAlert(game, source) {
  game.validCount++;
  recursiveSound(game, source.sector, 0, source);
}

function recursiveSound(game, sec, blocks, target) {
  if (sec.validCount === game.validCount && sec.soundTraversed <= blocks + 1) return;
  sec.validCount = game.validCount;
  sec.soundTraversed = blocks + 1;
  sec.soundTarget = target;
  for (const ld of sec.lines) {
    if (!ld.backSector || !ld.frontSector) continue;
    const open = Math.min(ld.frontSector.ceilingHeight, ld.backSector.ceilingHeight)
      - Math.max(ld.frontSector.floorHeight, ld.backSector.floorHeight);
    if (open <= 0) continue;
    const other = ld.frontSector === sec ? ld.backSector : ld.frontSector;
    if (ld.flags & LINE_FLAGS.BLOCK_SOUND) { if (!blocks) recursiveSound(game, other, 1, target); }
    else recursiveSound(game, other, blocks, target);
  }
}

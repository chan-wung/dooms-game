import { Game } from './game.js';
import { Mobj, kindInfo } from './mobj.js';
import { THING_INFO } from './info.js';
import { saveThinker, loadThinker } from './specials.js';
import { sectorAt } from '../render/bsp.js';

/**
 * 맵 도중 저장/불러오기. 게임 상태를 JSON 으로 바꿨다가, 새로 읽은 레벨 위에 되돌려 놓는다.
 *  - 레벨 구조(정점·선·BSP)는 WAD 에서 다시 읽으므로 저장하지 않는다. 바뀔 수 있는 값만 저장한다.
 *  - 물체끼리의 참조(target/owner)는 목록 번호로 저장한다 (-1 없음, -2 플레이어).
 */
const NONE = -1, PLAYER = -2;

const GAME_FIELDS = ['time', 'secretsFound', 'secretsTotal', 'message', 'messageTics', 'itemsFound', 'killsFound', 'flashDamage', 'hurtFace', 'lastDamage'];
const MOBJ_FIELDS = [
  'x', 'y', 'z', 'angle', 'momx', 'momy', 'momz', 'health', 'tics', 'stateLabel', 'stateIndex', 'frame', 'bright', 'seqIndex',
  'moveDir', 'moveCount', 'reaction', 'threshold', 'justHit', 'justAttacked', 'ambush', 'corpse', 'dropped',
  'missile', 'speed', 'damageScale', 'solid', 'shootable', 'hidden', 'height', 'floorz', 'ceilz',
  'spawnX', 'spawnY', 'spawnAngle', 'spawnAmbush',
];
const PLAYER_FIELDS = [
  'x', 'y', 'z', 'angle', 'momx', 'momy', 'momz', 'floorz', 'ceilz', 'viewheight', 'deltaViewheight', 'bob', 'viewz',
  'health', 'armor', 'armorType', 'backpack', 'readyWeapon', 'pendingWeapon', 'attackDown', 'refire', 'bulletSlope',
  'extraLight', 'grin', 'fireTics', 'damageCount', 'bonusCount', 'attackerAngle', 'dead', 'noclip', 'god', 'reaction', 'useHeld',
];
const copy = (o) => JSON.parse(JSON.stringify(o));

/** 지금 게임 상태 → 저장용 데이터 */
export function saveGame(game) {
  const { level, player: p } = game;
  const mobjs = game.mobjs.filter((m) => !m.removed);
  const index = new Map(mobjs.map((m, i) => [m, i]));
  const ref = (o) => (!o ? NONE : o === p ? PLAYER : index.get(o) ?? NONE);

  const player = { weapons: [...p.weapons], keys: { ...p.keys }, ammo: { ...p.ammo }, maxAmmo: { ...p.maxAmmo }, powers: { ...p.powers }, psp: copy(p.psp), attacker: ref(p.attacker) };
  for (const f of PLAYER_FIELDS) player[f] = p[f];

  const out = { rng: game.rng.state, player };
  for (const f of GAME_FIELDS) out[f] = game[f];
  out.sectors = level.sectors.map((s) => [s.floorHeight, s.ceilingHeight, s.floorTex, s.ceilingTex, s.light, s.special, s.soundTarget === p ? 1 : 0]);
  out.lines = level.linedefs.map((l) => {
    const r = l.right;
    return r ? [l.special, l.buttonActive ? 1 : 0, r.upperTex, r.midTex, r.lowerTex, r.xOffset] : [l.special, l.buttonActive ? 1 : 0];
  });
  out.mapped = level.linedefs.filter((l) => l.mapped).map((l) => l.index);
  out.thinkers = game.thinkers.map(saveThinker);
  out.mobjs = mobjs.map((m) => [m.type, ref(m.target), ref(m.owner), ...MOBJ_FIELDS.map((f) => m[f] ?? null)]);
  return out;
}

/** 새로 읽은 level 위에 저장된 상태를 복원한 Game */
export function loadGame(level, skill, s) {
  const game = new Game(level, skill, 1);
  const p = game.player;

  game.rng.state = s.rng;
  for (const f of GAME_FIELDS) game[f] = s[f];
  game.exited = null; game.dirty = false;

  // 섹터 / 선 (렌더러가 만들어 둔 캐시는 지운다)
  level.sectors.forEach((sec, i) => {
    const [floor, ceil, floorTex, ceilTex, light, special, soundPlayer] = s.sectors[i];
    Object.assign(sec, { floorHeight: floor, ceilingHeight: ceil, floorTex, ceilingTex: ceilTex, light, special });
    sec.floorFlat = sec.ceilFlat = null;
    sec.specialData = null;
    sec.soundTarget = soundPlayer ? p : null;
  });
  level.linedefs.forEach((l, i) => {
    const [special, button, upper, mid, lower, xOffset] = s.lines[i];
    l.special = special; l.buttonActive = !!button;
    if (l.right && upper !== undefined) Object.assign(l.right, { upperTex: upper, midTex: mid, lowerTex: lower, xOffset, tex: null });
  });
  for (const i of s.mapped ?? []) level.linedefs[i].mapped = true;
  game.thinkers = s.thinkers.map((d) => loadThinker(game, d));

  // 플레이어
  const ps = s.player;
  for (const f of PLAYER_FIELDS) p[f] = ps[f];
  p.weapons = new Set(ps.weapons);
  p.keys = { ...ps.keys }; p.ammo = { ...ps.ammo }; p.maxAmmo = { ...ps.maxAmmo }; p.powers = { ...ps.powers };
  p.psp = copy(ps.psp);
  p.sector = sectorAt(level, p.x, p.y);
  p.cmd = null;
  p.snapshot();

  // 물체
  const list = s.mobjs.map(([type, , , ...vals]) => {
    const d = Object.fromEntries(MOBJ_FIELDS.map((f, i) => [f, vals[i]]));
    const info = typeof type === 'string' ? kindInfo(type) : THING_INFO[type];
    const m = new Mobj(type, info, d.x, d.y, d.angle, sectorAt(level, d.x, d.y));
    for (const f of MOBJ_FIELDS) if (d[f] !== null) m[f] = d[f];
    return m;
  });
  const deref = (n) => (n === NONE ? null : n === PLAYER ? p : list[n] ?? null);
  s.mobjs.forEach(([, target, owner], i) => { list[i].target = deref(target); list[i].owner = deref(owner); });
  p.attacker = deref(ps.attacker);

  game.mobjs = list;
  game.physics.things = list.filter((m) => m.solid);
  game.shootables = list.filter((m) => m.shootable);
  game.effectCount = list.filter((m) => m.ai?.effect).length;
  return game;
}

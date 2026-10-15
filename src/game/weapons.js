import { aimLineAttack, lineAttack, noiseAlert, MELEE_RANGE, MISSILE_RANGE } from './combat.js';
import { startMissile } from './monsters.js';

/**
 * 플레이어 무기 (원작 p_pspr.c). 무기 스프라이트는 "psprite" 상태 머신으로 진행한다.
 *  - 상태 = [프레임, tic, 동작, 풀브라이트]. 상태에 들어갈 때 동작이 실행되고, tic 0 상태는 바로 다음으로 넘어간다.
 *  - 화면 위치 sx, sy: 가운데 = 1, 위 = 32(WEAPONTOP) ~ 아래 = 128(WEAPONBOTTOM).
 * 셰어웨어에 스프라이트가 없는 플라즈마/BFG 는 만들지 않았다.
 */
const S = (f, t, a = null, b = false) => ({ f, t, a, b });
const WEAPON_TOP = 32, WEAPON_BOTTOM = 128, SWITCH_SPEED = 6;
const TWO_PI = Math.PI * 2;
const spread = (game, shift) => ((game.rnd() - game.rnd()) * TWO_PI) / 2 ** (32 - shift);
const normAngle = (a) => { a %= TWO_PI; return a > Math.PI ? a - TWO_PI : a < -Math.PI ? a + TWO_PI : a; };

export const WEAPONS = {
  fist: {
    sprite: 'PUNG', ammo: null,
    ready: [S('A', 1, 'ready')], up: [S('A', 1, 'raise')], down: [S('A', 1, 'lower')],
    attack: [S('B', 4), S('C', 4, 'punch'), S('D', 5), S('C', 4), S('B', 5, 'refire')],
  },
  pistol: {
    sprite: 'PISG', ammo: 'clip',
    ready: [S('A', 1, 'ready')], up: [S('A', 1, 'raise')], down: [S('A', 1, 'lower')],
    attack: [S('A', 4), S('B', 6, 'firePistol'), S('C', 4), S('B', 5, 'refire')],
    flashSprite: 'PISF', flash: [S('A', 7, 'light1', true)],
  },
  shotgun: {
    sprite: 'SHTG', ammo: 'shell',
    ready: [S('A', 1, 'ready')], up: [S('A', 1, 'raise')], down: [S('A', 1, 'lower')],
    attack: [S('A', 3), S('A', 7, 'fireShotgun'), S('B', 5), S('C', 5), S('D', 4), S('C', 5), S('B', 5), S('A', 3), S('A', 7, 'refire')],
    flashSprite: 'SHTF', flash: [S('A', 4, 'light1', true), S('B', 3, 'light2', true)],
  },
  chaingun: {
    sprite: 'CHGG', ammo: 'clip',
    ready: [S('A', 1, 'ready')], up: [S('A', 1, 'raise')], down: [S('A', 1, 'lower')],
    attack: [S('A', 4, 'fireCGun'), S('B', 4, 'fireCGun'), S('B', 0, 'refire')],
    flashSprite: 'CHGF', flash: [S('A', 5, 'light1', true), S('B', 5, 'light2', true)],
  },
  chainsaw: {
    sprite: 'SAWG', ammo: null,
    ready: [S('C', 4, 'ready'), S('D', 4, 'ready')], up: [S('C', 1, 'raise')], down: [S('C', 1, 'lower')],
    attack: [S('A', 4, 'saw'), S('B', 4, 'saw'), S('B', 0, 'refire')],
  },
  rocketLauncher: {
    sprite: 'MISG', ammo: 'rocket',
    ready: [S('A', 1, 'ready')], up: [S('A', 1, 'raise')], down: [S('A', 1, 'lower')],
    attack: [S('B', 8, 'gunFlash'), S('B', 12, 'fireMissile'), S('B', 0, 'refire')],
    flashSprite: 'MISF', flash: [S('A', 3, 'light1', true), S('B', 4, null, true), S('C', 4, 'light2', true), S('D', 4, 'light2', true)],
  },
};

/** 숫자 키 → 무기 */
const KEY_WEAPONS = { 2: 'pistol', 3: 'shotgun', 4: 'chaingun', 5: 'rocketLauncher' };
const CYCLE = ['fist', 'chainsaw', 'pistol', 'shotgun', 'chaingun', 'rocketLauncher'];

export const newPsprites = () => ({
  weapon: { label: 'down', idx: 0, tics: 1, frame: 0, bright: false, sx: 1, sy: WEAPON_BOTTOM },
  flash: null, // { def 의 flash 목록 진행 상태 }
});

// ---------- psprite 상태 진행 ----------
function setWeaponState(game, p, label, idx = 0) {
  const ps = p.psp.weapon;
  for (let guard = 0; guard < 10; guard++) {
    const list = WEAPONS[p.readyWeapon][label];
    const s = list[idx];
    ps.label = label; ps.idx = idx; ps.frame = s.f.charCodeAt(0) - 65; ps.bright = s.b; ps.tics = s.t;
    if (s.a) ACTIONS[s.a]?.(game, p);
    // 동작이 상태를 바꿨다면(label/idx 가 달라짐) 여기서 중단
    if (ps.label !== label || ps.idx !== idx) return;
    if (ps.tics !== 0) return;
    idx++;                                           // tic 0 상태는 즉시 다음으로
    if (idx >= list.length) { if (label === 'attack') { label = 'ready'; idx = 0; } else idx = 0; }
  }
}

function setFlash(game, p, idx = 0) {
  const def = WEAPONS[p.readyWeapon];
  if (!def.flash) return;
  const s = def.flash[idx];
  p.psp.flash = { idx, frame: s.f.charCodeAt(0) - 65, tics: s.t, bright: s.b };
  if (s.a) ACTIONS[s.a]?.(game, p);
}

function tickFlash(game, p) {
  const fl = p.psp.flash;
  if (!fl) return;
  if (--fl.tics > 0) return;
  const list = WEAPONS[p.readyWeapon].flash;
  if (fl.idx + 1 < list.length) setFlash(game, p, fl.idx + 1);
  else { p.psp.flash = null; p.extraLight = 0; }
}

function tickWeapon(game, p) {
  const ps = p.psp.weapon;
  if (--ps.tics > 0) return;
  const list = WEAPONS[p.readyWeapon][ps.label];
  let idx = ps.idx + 1, label = ps.label;
  if (idx >= list.length) { idx = 0; if (label === 'attack') label = 'ready'; }
  setWeaponState(game, p, label, idx);
}

// ---------- 무기 선택 / 탄약 ----------
export function bringUpWeapon(game, p) {
  if (!p.pendingWeapon) p.pendingWeapon = p.readyWeapon;
  p.readyWeapon = p.pendingWeapon;
  p.pendingWeapon = null;
  p.psp.weapon.sy = WEAPON_BOTTOM;
  setWeaponState(game, p, 'up');
}

/** 숫자 키(1~7)로 무기 교체 요청 */
export function requestWeapon(p, n) {
  let w = n === 1 ? ((p.weapons.has('chainsaw') && p.readyWeapon !== 'chainsaw') ? 'chainsaw' : 'fist') : KEY_WEAPONS[n];
  if (!w || !p.weapons.has(w) || w === p.readyWeapon) return;
  p.pendingWeapon = w;
}

/** 마우스 휠: 가진 무기를 순서대로 */
export function cycleWeapon(p, dir) {
  const owned = CYCLE.filter((w) => p.weapons.has(w));
  const i = owned.indexOf(p.pendingWeapon ?? p.readyWeapon);
  const next = owned[(i + dir + owned.length) % owned.length];
  if (next && next !== p.readyWeapon) p.pendingWeapon = next;
}

const enoughAmmo = (p) => {
  const a = WEAPONS[p.readyWeapon].ammo;
  return a === null || p.ammo[a] >= 1;
};

/** 탄약이 부족하면 가장 좋은 다른 무기로 바꾼다 (원작 P_CheckAmmo). 충분하면 true */
function checkAmmo(game, p) {
  if (enoughAmmo(p)) return true;
  const has = (w, ammo) => p.weapons.has(w) && p.ammo[ammo] >= 1;
  if (has('chaingun', 'clip')) p.pendingWeapon = 'chaingun';
  else if (has('shotgun', 'shell')) p.pendingWeapon = 'shotgun';
  else if (p.ammo.clip >= 1 && p.weapons.has('pistol')) p.pendingWeapon = 'pistol';
  else if (p.weapons.has('chainsaw')) p.pendingWeapon = 'chainsaw';
  else if (has('rocketLauncher', 'rocket')) p.pendingWeapon = 'rocketLauncher';
  else p.pendingWeapon = 'fist';
  setWeaponState(game, p, 'down');
  return false;
}

function fireWeapon(game, p) {
  if (!checkAmmo(game, p)) return;
  setWeaponState(game, p, 'attack');
  noiseAlert(game, p);                      // 총소리에 몬스터가 깨어난다
}

// ---------- 사격 ----------
const useAmmo = (p) => { const a = WEAPONS[p.readyWeapon].ammo; if (a) p.ammo[a]--; };

/** 조준: 정면 → 위 5.6° → 아래 5.6° 순으로 목표를 찾는다. 높이(slope)만 맞추고 방향은 그대로 */
function bulletSlope(game, p) {
  const step = Math.PI / 32;
  let aim = aimLineAttack(game, p, p.angle, 1024)
    ?? aimLineAttack(game, p, p.angle + step, 1024)
    ?? aimLineAttack(game, p, p.angle - step, 1024);
  p.bulletSlope = aim ? aim.slope : 0;
}

function gunShot(game, p, accurate) {
  const damage = 5 * ((game.rnd() % 3) + 1);
  let angle = p.angle;
  if (!accurate) angle += spread(game, 18);
  lineAttack(game, p, angle, MISSILE_RANGE, p.bulletSlope, damage);
}

const ACTIONS = {
  /** 대기: 무기 교체/발사 확인, 걸을 때 흔들림 */
  ready(game, p) {
    const ps = p.psp.weapon;
    if (p.pendingWeapon || p.dead) { setWeaponState(game, p, 'down'); return; }
    if (p.cmd?.fire) {
      if (!p.attackDown || (p.readyWeapon !== 'rocketLauncher')) { p.attackDown = true; fireWeapon(game, p); return; }
    } else {
      p.attackDown = false;
    }
    const angle = (((128 * game.time) & 8191) / 8192) * TWO_PI;
    ps.sx = 1 + p.bob * Math.cos(angle);
    ps.sy = WEAPON_TOP + p.bob * Math.sin(angle % Math.PI);
  },

  lower(game, p) {
    const ps = p.psp.weapon;
    ps.sy += SWITCH_SPEED;
    if (ps.sy < WEAPON_BOTTOM) return;
    if (p.dead) { ps.sy = WEAPON_BOTTOM; return; }
    bringUpWeapon(game, p);
  },

  raise(game, p) {
    const ps = p.psp.weapon;
    ps.sy -= SWITCH_SPEED;
    if (ps.sy > WEAPON_TOP) return;
    ps.sy = WEAPON_TOP;
    setWeaponState(game, p, 'ready');
  },

  /** 발사 버튼을 계속 누르고 있으면 다시 쏜다 */
  refire(game, p) {
    if (p.cmd?.fire && !p.pendingWeapon && !p.dead) { p.refire++; fireWeapon(game, p); }
    else { p.refire = 0; checkAmmo(game, p); }
  },

  firePistol(game, p) {
    useAmmo(p); setFlash(game, p);
    bulletSlope(game, p); gunShot(game, p, !p.refire);
  },

  fireShotgun(game, p) {
    useAmmo(p); setFlash(game, p);
    bulletSlope(game, p);
    for (let i = 0; i < 7; i++) gunShot(game, p, false);
  },

  fireCGun(game, p) {
    useAmmo(p);
    setFlash(game, p, p.psp.weapon.idx);   // 발사 프레임(A/B)에 맞춰 화염도 번갈아
    bulletSlope(game, p); gunShot(game, p, !p.refire);
  },

  gunFlash(game, p) { setFlash(game, p); },

  fireMissile(game, p) {
    useAmmo(p);
    spawnPlayerMissile(game, p, 'rocket');
  },

  punch(game, p) {
    let damage = ((game.rnd() % 10) + 1) * 2;
    if (p.powers.berserk) damage *= 10;
    const angle = p.angle + spread(game, 18);
    const aim = aimLineAttack(game, p, angle, MELEE_RANGE);
    const hit = lineAttack(game, p, angle, MELEE_RANGE, aim ? aim.slope : 0, damage);
    if (hit) p.angle = Math.atan2(hit.y - p.y, hit.x - p.x);   // 맞은 쪽으로 몸이 돌아감
  },

  saw(game, p) {
    const damage = 2 * ((game.rnd() % 10) + 1);
    const angle = p.angle + spread(game, 18);
    const aim = aimLineAttack(game, p, angle, MELEE_RANGE + 1);
    const hit = lineAttack(game, p, angle, MELEE_RANGE + 1, aim ? aim.slope : 0, damage);
    if (!hit) return;
    // 부드럽게 목표 쪽으로 돌아봄
    const diff = normAngle(Math.atan2(hit.y - p.y, hit.x - p.x) - p.angle), step = Math.PI / 2 / 20;
    p.angle += Math.abs(diff) > step ? Math.sign(diff) * step : diff;
  },

  light0(game, p) { p.extraLight = 0; },
  light1(game, p) { p.extraLight = 1; },
  light2(game, p) { p.extraLight = 2; },
};

/** 로켓: 정면(또는 ±5.6° 안의 목표)을 조준해 발사 */
function spawnPlayerMissile(game, p, kind) {
  const step = Math.PI / 32;
  let angle = p.angle, aim = aimLineAttack(game, p, angle, 1024);
  if (!aim) { angle = p.angle + step; aim = aimLineAttack(game, p, angle, 1024); }
  if (!aim) { angle = p.angle - step; aim = aimLineAttack(game, p, angle, 1024); }
  if (!aim) angle = p.angle;
  const m = game.spawnKind(kind, p.x, p.y, p.z + 32);
  m.owner = p; m.target = p; m.angle = angle;
  m.momx = m.speed * Math.cos(angle); m.momy = m.speed * Math.sin(angle);
  m.momz = m.speed * (aim ? aim.slope : 0);
  startMissile(game, m);
}

/** 매 tic: 무기 상태 진행 (플레이어 tick 에서 호출). cmd = { fire, ... } */
export function tickWeapons(game, p, cmd) {
  p.cmd = cmd;
  tickWeapon(game, p);
  tickFlash(game, p);
}

/** 레벨 시작/부활 시 무기 준비 */
export function setupWeapons(game, p) {
  p.readyWeapon = 'pistol';
  p.pendingWeapon = 'pistol';
  p.psp = newPsprites();
  bringUpWeapon(game, p);
}

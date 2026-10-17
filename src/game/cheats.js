import { POWER_TICS } from './items.js';

/**
 * 치트 (원작 st_stuff.c). 키보드로 치는 코드와 옵션 메뉴의 CHEATS 가 같은 함수를 부른다.
 * 오토맵 보기(IDDT)와 맵 이동(IDCLEV)은 화면 쪽 상태가 필요해서 main.js 가 처리하고, 여기서는 코드 해석만 한다.
 */
const WEAPON_LIST = ['fist', 'pistol', 'shotgun', 'chaingun', 'chainsaw', 'rocketLauncher'];
const REGISTERED_WEAPONS = ['plasmaGun', 'bfg'];   // 셰어웨어 WAD 에는 그림이 없어 정식판에서만 준다 (game.registered)

const fullAmmo = (p) => { for (const k of Object.keys(p.ammo)) p.ammo[k] = p.maxAmmo[k]; };
const fullWeapons = (game, p) => {
  for (const w of WEAPON_LIST) p.weapons.add(w);
  if (game.registered) for (const w of REGISTERED_WEAPONS) p.weapons.add(w);
};
const blueArmor = (p) => { p.armor = 200; p.armorType = 2; };

/** IDDQD: 무적 (켜면 체력도 100 으로) */
export function toggleGod(game) {
  const p = game.player;
  if (p.dead) return;
  p.god = !p.god;
  if (p.god) p.health = Math.max(p.health, 100);
  game.say(p.god ? 'Degreelessness Mode On' : 'Degreelessness Mode Off', true);
}

/** IDCLIP */
export function toggleNoclip(game) {
  const p = game.player;
  p.noclip = !p.noclip;
  game.say(p.noclip ? 'No Clipping Mode ON' : 'No Clipping Mode OFF', true);
}

/** IDKFA: 무기·탄약·열쇠·파란 방어구 */
export function giveKfa(game) {
  const p = game.player;
  if (p.dead) return;
  fullWeapons(game, p); fullAmmo(p); blueArmor(p);
  Object.assign(p.keys, { blue: true, yellow: true, red: true });
  game.say('Very Happy Ammo Added', true);
}

/** IDFA: 무기·탄약·방어구 (열쇠 없음) */
export function giveFa(game) {
  const p = game.player;
  if (p.dead) return;
  fullWeapons(game, p); fullAmmo(p); blueArmor(p);
  game.say('Ammo (no keys) Added', true);
}

export const POWER_IDS = ['invuln', 'berserk', 'invis', 'radsuit', 'automap', 'lightamp'];

/** IDBEHOLD: 파워업을 켜고 끈다 (버서크는 주기만 한다) */
export function togglePower(game, id) {
  const p = game.player;
  if (p.dead) return;
  if (id === 'berserk') {
    p.health = Math.max(p.health, 100); p.powers.berserk = 1; p.pendingWeapon = 'fist';
  } else if (id === 'automap') {
    p.powers.automap = !p.powers.automap;
  } else if (id in POWER_TICS) {
    p.powers[id] = p.powers[id] > 0 ? 0 : POWER_TICS[id];
  }
  game.say('Power-up Toggled', true);
}

/** IDCHOPPERS */
export function giveChainsaw(game) {
  const p = game.player;
  p.weapons.add('chainsaw'); p.weapons.add('fist');
  game.say('... doesn\'t suck - GM', true);
}

/** IDMYPOS */
export function showPosition(game) {
  const p = game.player;
  game.say(`ang=${Math.round(((p.angle * 180) / Math.PI + 360) % 360)};x,y=(${Math.round(p.x)},${Math.round(p.y)})`, true);
}

// ---------- 키보드로 치는 코드 ----------
const BEHOLD = { v: 'invuln', s: 'berserk', i: 'invis', r: 'radsuit', a: 'automap', l: 'lightamp' };
const CODES = {
  iddqd: { name: 'god' }, idkfa: { name: 'kfa' }, idfa: { name: 'fa' },
  idclip: { name: 'noclip' }, idspispopd: { name: 'noclip' },
  iddt: { name: 'map' }, idchoppers: { name: 'chainsaw' }, idmypos: { name: 'pos' },
  ...Object.fromEntries(Object.entries(BEHOLD).map(([k, id]) => [`idbehold${k}`, { name: 'power', arg: id }])),
};
const PREFIXES = new Set();
for (const code of [...Object.keys(CODES), 'idbehold', 'idclev']) for (let i = 1; i <= code.length; i++) PREFIXES.add(code.slice(0, i));
const CLEV = /^idclev(\d)(\d)$/;
const isPrefix = (s) => PREFIXES.has(s) || /^idclev\d$/.test(s) || CLEV.test(s);
const TYPE_TIMEOUT = 2500;

/** 친 글자를 모아 치트 코드가 되면 알려 준다. 코드를 치는 중에는 active 가 true 라서 다른 단축키가 끼어들지 않게 할 수 있다 */
export class CheatTyper {
  constructor() { this.buf = ''; this.at = 0; }

  get active() { return this.buf.length > 0; }

  reset() { this.buf = ''; }

  /** ch: 소문자 한 글자 또는 숫자. 코드가 완성되면 { name, arg } */
  feed(ch, now) {
    if (now - this.at > TYPE_TIMEOUT) this.buf = '';
    this.at = now;
    this.buf += ch;
    while (this.buf && !isPrefix(this.buf)) this.buf = this.buf.slice(1);
    const b = this.buf;
    if (CODES[b]) { this.buf = ''; return CODES[b]; }
    const m = CLEV.exec(b);
    if (m) { this.buf = ''; return { name: 'warp', arg: `E${m[1]}M${m[2]}` }; }
    if (b === 'idbehold') return { name: 'beholdHelp' };
    return null;
  }
}

/** KeyboardEvent.code → 치트에 쓰는 글자 (치트와 무관한 키는 null) */
export const cheatChar = (code) => {
  const m = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code);
  return m ? m[1].toLowerCase() : null;
};

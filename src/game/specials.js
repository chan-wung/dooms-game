import { sectorAt } from '../render/bsp.js';
import { t } from '../app/i18n.js';
import { LINE_FLAGS } from '../wad/level.js';
import { Physics } from './physics.js';
import { damageMobj } from './combat.js';
import {
  lowestFloorSurrounding, highestFloorSurrounding, nextHighestFloor, lowestCeilingSurrounding, highestCeilingSurrounding,
  shortestLowerTexture, minSurroundingLight, maxSurroundingLight, nextSector,
} from './sectors.js';

/**
 * 특수 효과 (원작 p_spec.c, p_doors.c, p_plats.c, p_floor.c, p_lights.c, p_switch.c 를 단순화).
 *  - thinker: 매 tic(1/35초) tick() 을 호출받는 움직이는 것들. true 를 돌려주면 제거된다.
 *  - 선 특수 효과 번호 → { 발동 방식(걷기/사용), 반복 여부, 동작 } 표.
 * 원작 1.9 의 선 특수 효과를 모두 다룬다 (크러셔·영구 리프트·열쇠 고속문·몬스터 전용 텔레포트 포함).
 */
const OK = 0, CRUSHED = 1, PASTDEST = 2;
const VDOORSPEED = 2, VDOORWAIT = 150;
const PLATSPEED = 1, PLATWAIT = 105; // 35 tic × 3초
const FLOORSPEED = 1;
const CEILSPEED = 1;
const BUTTONTIME = 35;

/**
 * 바닥/천장을 한 걸음 움직인다. 움직인 결과 플레이어가 끼면 되돌리고 CRUSHED.
 * @param ceiling true = 천장, false = 바닥 / dir: 1 위, -1 아래
 */
function movePlane(game, sec, speed, dest, crush, ceiling, dir) {
  const key = ceiling ? 'ceilingHeight' : 'floorHeight';
  const last = sec[key];
  const blocked = () => game.changeSector(sec, crush);

  if (dir === -1) {
    if (last - speed < dest) {
      sec[key] = dest;
      if (blocked()) { sec[key] = last; blocked(); return ceiling ? CRUSHED : PASTDEST; }
      return PASTDEST;
    }
    sec[key] = last - speed;
    if (blocked()) {
      if (crush) return CRUSHED;
      sec[key] = last; blocked(); return CRUSHED;
    }
    return OK;
  }

  if (last + speed > dest) {
    sec[key] = dest;
    if (blocked() && !ceiling) { sec[key] = last; blocked(); }
    return PASTDEST;
  }
  sec[key] = last + speed;
  if (blocked()) {
    if (crush) return CRUSHED;
    sec[key] = last; blocked(); return CRUSHED;
  }
  return OK;
}

/** 섹터 소리의 위치: 섹터에 접한 선들의 경계 상자 중심 */
export const soundOrigin = (sec) => {
  if (!sec.soundOrg) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of sec.lines) { x0 = Math.min(x0, l.minX); x1 = Math.max(x1, l.maxX); y0 = Math.min(y0, l.minY); y1 = Math.max(y1, l.maxY); }
    sec.soundOrg = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  return sec.soundOrg;
};

// ---------- thinker: 문 ----------
class Door {
  /** type: normal | close | open | close30ThenOpen | blazeRaise | blazeOpen | blazeClose */
  constructor(game, sec, type, direction, speed, topHeight) {
    this.game = game; this.sector = sec; this.type = type;
    this.direction = direction; this.speed = speed; this.topHeight = topHeight;
    this.countdown = 0;
    sec.specialData = this;
    this.sound();
  }

  /** 지금 방향(열림/닫힘)에 맞는 소리 */
  sound() {
    const blaze = this.type.startsWith('blaze');
    this.game.playSound(this.direction === 1 ? (blaze ? 'BDOPN' : 'DOROPN') : (blaze ? 'BDCLS' : 'DORCLS'), soundOrigin(this.sector));
  }

  tick() {
    const { game, sector: sec, type } = this;
    switch (this.direction) {
      case 2: // 맵 시작 후 5분 기다렸다가 열림 (섹터 특수 14)
        if (--this.countdown === 0) { this.direction = 1; this.type = 'normal'; this.sound(); }
        break;
      case 0: // 위에서 대기
        if (--this.countdown === 0) {
          if (type === 'normal' || type === 'blazeRaise') this.direction = -1;
          else if (type === 'close30ThenOpen') this.direction = 1;
          this.sound();
        }
        break;
      case -1: { // 닫히는 중
        const res = movePlane(game, sec, this.speed, sec.floorHeight, false, true, -1);
        if (res === PASTDEST) {
          if (type === 'close30ThenOpen') { this.direction = 0; this.countdown = 35 * 30; }
          else { sec.specialData = null; return true; }
        } else if (res === CRUSHED && type !== 'blazeClose' && type !== 'close') {
          this.direction = 1; // 뭔가 끼면 다시 열림
          this.sound();
        }
        break;
      }
      case 1: { // 열리는 중
        const res = movePlane(game, sec, this.speed, this.topHeight, false, true, 1);
        if (res === PASTDEST) {
          if (type === 'normal' || type === 'blazeRaise') { this.direction = 0; this.countdown = VDOORWAIT; }
          else { sec.specialData = null; return true; }
        }
        break;
      }
    }
    return false;
  }
}

// ---------- thinker: 리프트 ----------
class Plat {
  /** type: downWaitUpStay | blazeDWUS | raiseToNearestAndChange | raiseAndChange | perpetual */
  constructor(game, sec, type, speed, low, high, wait, status) {
    this.game = game; this.sector = sec; this.type = type;
    this.speed = speed; this.low = low; this.high = high; this.wait = wait;
    this.status = status; this.count = 0;
    this.oldStatus = null;        // 멈춤 선(54·89)으로 멈췄을 때 원래 상태 (status = 'stasis')
    sec.specialData = this;
    game.playSound(type === 'raiseAndChange' || type === 'raiseToNearestAndChange' ? 'STNMOV' : 'PSTART', soundOrigin(sec));
  }

  tick() {
    const { game, sector: sec } = this;
    switch (this.status) {
      case 'stasis': break;
      case 'up': {
        const res = movePlane(game, sec, this.speed, this.high, false, false, 1);
        if (res === CRUSHED) { this.count = this.wait; this.status = 'down'; game.playSound('PSTART', soundOrigin(sec)); }
        else if (res === PASTDEST) {
          this.count = this.wait; this.status = 'waiting';
          game.playSound('PSTOP', soundOrigin(sec));
          if (this.type !== 'perpetual') { sec.specialData = null; return true; }
        }
        break;
      }
      case 'down': {
        const res = movePlane(game, sec, this.speed, this.low, false, false, -1);
        if (res === PASTDEST) { this.count = this.wait; this.status = 'waiting'; game.playSound('PSTOP', soundOrigin(sec)); }
        break;
      }
      case 'waiting':
        if (--this.count <= 0) { this.status = sec.floorHeight === this.low ? 'up' : 'down'; game.playSound('PSTART', soundOrigin(sec)); }
        break;
    }
    return false;
  }
}

// ---------- thinker: 바닥 ----------
class FloorMover {
  /**
   * change: 도착하면 바닥 무늬와 섹터 특수를 바꾼다 (도넛, 내려가며 바꾸기) = { tex, special }
   * crush: 끼인 것을 짓누르며 계속 올라간다 (특수 55·56·65·94)
   */
  constructor(game, sec, direction, speed, dest, change = null, crush = false) {
    this.game = game; this.sector = sec; this.direction = direction; this.speed = speed; this.dest = dest;
    this.changeTex = change ? change.tex : null; this.changeSpecial = change ? change.special : 0;   // 저장할 수 있게 값으로 둔다
    this.crush = crush;
    sec.specialData = this;
  }

  tick() {
    const sec = this.sector;
    const res = movePlane(this.game, sec, this.speed, this.dest, !!this.crush, false, this.direction);
    if (!(this.game.time & 7)) this.game.playSound('STNMOV', soundOrigin(sec));
    if (res === PASTDEST) {
      this.game.playSound('PSTOP', soundOrigin(sec));
      if (this.changeTex) { sec.floorTex = this.changeTex; sec.floorFlat = null; sec.special = this.changeSpecial; }
      sec.specialData = null;
      return true;
    }
    return false;
  }
}

// ---------- thinker: 천장 (크러셔) ----------
class Ceiling {
  /** type: lowerToFloor | raiseToHighest | lowerAndCrush | crushAndRaise | fastCrushAndRaise | silentCrushAndRaise */
  constructor(game, sec, type, direction, speed, bottom, top, crush) {
    this.game = game; this.sector = sec; this.type = type;
    this.direction = direction; this.speed = speed; this.bottom = bottom; this.top = top; this.crush = crush;
    this.oldDirection = 0;        // 멈춤 선(57·74)으로 멈췄을 때 원래 방향 (direction = 0)
    this.tag = sec.tag;
    sec.specialData = this;
  }

  get crusher() { return this.type.endsWith('CrushAndRaise') || this.type === 'crushAndRaise'; }

  tick() {
    const { game, sector: sec, type } = this;
    const silent = type === 'silentCrushAndRaise';
    if (this.direction === 0) return false;
    if (!silent && !(game.time & 7)) game.playSound('STNMOV', soundOrigin(sec));
    if (this.direction === 1) {
      const res = movePlane(game, sec, this.speed, this.top, false, true, 1);
      if (res !== PASTDEST) return false;
      if (!this.crusher) { sec.specialData = null; return true; }
      if (silent) game.playSound('PSTOP', soundOrigin(sec));
      this.direction = -1;
      return false;
    }
    const res = movePlane(game, sec, this.speed, this.bottom, this.crush, true, -1);
    if (res === PASTDEST) {
      if (!this.crusher) { sec.specialData = null; return true; }
      if (silent) game.playSound('PSTOP', soundOrigin(sec));
      if (type === 'crushAndRaise' || silent) this.speed = CEILSPEED;
      this.direction = 1;
    } else if (res === CRUSHED && type !== 'fastCrushAndRaise' && type !== 'lowerToFloor' && type !== 'raiseToHighest') {
      this.speed = CEILSPEED / 8;   // 뭔가 끼면 천천히 짓누른다
    }
    return false;
  }
}

// ---------- thinker: 조명 ----------
class LightFlash { // 불규칙 깜빡임 (섹터 특수 1)
  constructor(game, sec) {
    this.rnd = game.rnd;
    this.sec = sec; this.max = sec.light; this.min = minSurroundingLight(sec, sec.light);
    this.count = (this.rnd() & 64) + 1;
  }
  tick() {
    if (--this.count > 0) return false;
    if (this.sec.light === this.max) { this.sec.light = this.min; this.count = (this.rnd() & 7) + 1; }
    else { this.sec.light = this.max; this.count = (this.rnd() & 64) + 1; }
    return false;
  }
}

class Strobe { // 일정한 점멸 (섹터 특수 2, 3, 4, 12, 13)
  constructor(game, sec, darkTime, inSync) {
    this.rnd = game.rnd;
    this.sec = sec; this.darkTime = darkTime; this.brightTime = 5;
    this.max = sec.light;
    this.min = minSurroundingLight(sec, sec.light);
    if (this.min === this.max) this.min = 0;
    this.count = inSync ? 1 : (this.rnd() & 7) + 1;
  }
  tick() {
    if (--this.count > 0) return false;
    if (this.sec.light === this.min) { this.sec.light = this.max; this.count = this.brightTime; }
    else { this.sec.light = this.min; this.count = this.darkTime; }
    return false;
  }
}

class Glow { // 천천히 밝아졌다 어두워짐 (섹터 특수 8)
  constructor(sec) {
    this.sec = sec; this.min = minSurroundingLight(sec, sec.light); this.max = sec.light; this.dir = -1;
  }
  tick() {
    const s = this.sec;
    if (this.dir === -1) { s.light -= 8; if (s.light <= this.min) { s.light += 8; this.dir = 1; } }
    else { s.light += 8; if (s.light >= this.max) { s.light -= 8; this.dir = -1; } }
    return false;
  }
}

class FireFlicker { // 불꽃 (섹터 특수 17)
  constructor(game, sec) { this.rnd = game.rnd; this.sec = sec; this.max = sec.light; this.min = minSurroundingLight(sec, sec.light) + 16; this.count = 4; }
  tick() {
    if (--this.count > 0) return false;
    const amount = (this.rnd() & 3) * 16;
    this.sec.light = this.sec.light - amount < this.min ? this.min : this.max - amount;
    this.count = 4;
    return false;
  }
}

class ButtonTimer { // 반복 스위치가 일정 시간 뒤 원래 모양으로
  constructor(specials, line) { this.specials = specials; this.line = line; this.timer = BUTTONTIME; line.buttonActive = true; }
  tick() {
    if (--this.timer > 0) return false;
    this.specials.swapSwitchTextures(this.line);
    this.line.buttonActive = false;
    return true;
  }
}

class WallScroll { // 특수 48: 벽 텍스처가 계속 흐름
  constructor(line) { this.line = line; }
  tick() { if (this.line.right) this.line.right.xOffset += 1; return false; }
}

// ---------- 세이브/로드: thinker 직렬화 ----------
const THINKER_KINDS = {
  door: Door, plat: Plat, floor: FloorMover, flash: LightFlash, strobe: Strobe,
  glow: Glow, fire: FireFlicker, button: ButtonTimer, scroll: WallScroll, ceiling: Ceiling,
};
const CLAIMS_SECTOR = new Set([Door, Plat, FloorMover, Ceiling]);  // 만든 쪽이 sector.specialData 에 자신을 건다
const RUNTIME_LINKS = ['game', 'rnd', 'specials'];         // 저장하지 않고 불러올 때 다시 연결

/** thinker → 순수 데이터 (섹터/선은 인덱스로 참조) */
export function saveThinker(t) {
  const kind = Object.keys(THINKER_KINDS).find((k) => t instanceof THINKER_KINDS[k]);
  const d = { kind };
  for (const [k, v] of Object.entries(t)) {
    if (RUNTIME_LINKS.includes(k)) continue;
    d[k] = v && typeof v === 'object' ? ('floorHeight' in v ? { sec: v.index } : { line: v.index }) : v;
  }
  return d;
}

export function loadThinker(game, d) {
  const C = THINKER_KINDS[d.kind];
  const t = Object.create(C.prototype);   // 생성자의 소리/연결 부작용 없이 상태만 복원
  for (const [k, v] of Object.entries(d)) {
    if (k === 'kind') continue;
    t[k] = v && typeof v === 'object' ? ('sec' in v ? game.level.sectors[v.sec] : game.level.linedefs[v.line]) : v;
  }
  t.game = game; t.rnd = game.rnd; t.specials = game.specials;
  if (CLAIMS_SECTOR.has(C)) t.sector.specialData = t;
  return t;
}

// ---------- 선 특수 효과 표 ----------
/** 이름 → [걷기 1회, 걷기 반복, 스위치 1회, 스위치 반복] 번호 */
const DOOR_NUMS = {
  open: [2, 86, 103, 61], close: [3, 75, 50, 42], normal: [4, 90, 29, 63], close30ThenOpen: [16, 76],
  blazeRaise: [108, 105, 111, 114], blazeOpen: [109, 106, 112, 115], blazeClose: [110, 107, 113, 116],
};
const FLOOR_NUMS = {
  raiseFloor: [5, 91, 101, 64], raiseFloorToNearest: [119, 128, 18, 69],
  lowerFloorToLowest: [38, 82, 23, 60], lowerFloor: [19, 83, 102, 45], turboLower: [36, 98, 71, 70],
};
const KEY_DOORS = { 26: 'blue', 32: 'blue', 27: 'yellow', 34: 'yellow', 28: 'red', 33: 'red' };
const MANUAL_DOORS = new Set([1, 26, 27, 28, 31, 32, 33, 34, 117, 118]);
const MONSTER_CROSS = new Set([4, 10, 39, 88, 97, 125, 126]);   // 몬스터도 밟으면 작동하는 걷기 선 (원작 P_CrossSpecialLine): 문 열기, 리프트, 텔레포트

export class Specials {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    this.table = new Map();
    this.buildTable();
  }

  // ---------- 표 만들기 ----------
  /** trigger: 'walk' | 'use' */
  def(num, trigger, repeat, action) { this.table.set(num, { trigger, repeat, action }); }

  buildTable() {
    const g = this.game;
    const kinds = [['walk', false], ['walk', true], ['use', false], ['use', true]];

    for (const [type, nums] of Object.entries(DOOR_NUMS)) {
      nums.forEach((n, i) => this.def(n, kinds[i][0], kinds[i][1], (line) => this.doDoor(line, type)));
    }
    for (const [type, nums] of Object.entries(FLOOR_NUMS)) {
      nums.forEach((n, i) => this.def(n, kinds[i][0], kinds[i][1], (line) => this.doFloor(line, type)));
    }
    // 리프트
    for (const [n, i] of [[10, 0], [88, 1], [21, 2], [62, 3]]) this.def(n, kinds[i][0], kinds[i][1], (l) => this.doPlat(l, 'downWaitUpStay'));
    for (const [n, i] of [[121, 0], [120, 1], [122, 2], [123, 3]]) this.def(n, kinds[i][0], kinds[i][1], (l) => this.doPlat(l, 'blazeDWUS'));
    for (const [n, i] of [[22, 0], [95, 1], [20, 2], [68, 3]]) this.def(n, kinds[i][0], kinds[i][1], (l) => this.doPlat(l, 'raiseToNearestAndChange'));
    // 계단
    this.def(8, 'walk', false, (l) => this.buildStairs(l, 8, FLOORSPEED / 4));
    this.def(7, 'use', false, (l) => this.buildStairs(l, 8, FLOORSPEED / 4));
    this.def(100, 'walk', false, (l) => this.buildStairs(l, 16, FLOORSPEED * 4));
    this.def(127, 'use', false, (l) => this.buildStairs(l, 16, FLOORSPEED * 4));
    // 도넛: 가운데 기둥은 내려가고, 둘러싼 바닥은 바깥 바닥의 높이·무늬로 올라간다
    this.def(9, 'use', false, (l) => this.doDonut(l));
    // 조명: 특수 → [밝기 지정 | 'brightest'], 걷기 1회/반복, 스위치
    const lights = [[35, 'walk', false, 35], [79, 'walk', true, 35], [139, 'use', true, 35],
      [12, 'walk', false, 'brightest'], [80, 'walk', true, 'brightest'],
      [13, 'walk', false, 255], [81, 'walk', true, 255], [138, 'use', true, 255]];
    for (const [n, t, rep, v] of lights) this.def(n, t, rep, (l) => this.setLights(l.tag, v));
    // 출구
    this.def(11, 'use', false, () => { g.exitLevel(false); return true; });
    this.def(51, 'use', false, () => { g.exitLevel(true); return true; });
    this.def(52, 'walk', false, () => { g.exitLevel(false); return true; });
    this.def(124, 'walk', false, () => { g.exitLevel(true); return true; });
    // 텔레포트 (뒷면에서 들어가면 무시)
    this.def(39, 'walk', false, (l, side, who) => this.teleport(l, side, who));
    this.def(97, 'walk', true, (l, side, who) => this.teleport(l, side, who));
    // 몬스터만 쓰는 텔레포트
    this.def(125, 'walk', false, (l, side, who) => who !== g.player && this.teleport(l, side, who));
    this.def(126, 'walk', true, (l, side, who) => who !== g.player && this.teleport(l, side, who));

    // ----- 그 밖의 바닥 (번호 → [발동, 반복]) -----
    const more = (type, list) => { for (const [n, t, rep] of list) this.def(n, t, rep, (l) => this.doFloor(l, type)); };
    more('raiseToTexture', [[30, 'walk', false], [96, 'walk', true]]);
    more('lowerAndChange', [[37, 'walk', false], [84, 'walk', true]]);
    more('raiseFloorCrush', [[56, 'walk', false], [94, 'walk', true], [55, 'use', false], [65, 'use', true]]);
    more('raiseFloor24', [[58, 'walk', false], [92, 'walk', true]]);
    more('raiseFloor24AndChange', [[59, 'walk', false], [93, 'walk', true]]);
    more('raiseFloorTurbo', [[130, 'walk', false], [129, 'walk', true], [131, 'use', false], [132, 'use', true]]);
    more('raiseFloor512', [[140, 'use', false]]);
    // ----- 그 밖의 리프트 -----
    for (const [n, t, rep, amount] of [[15, 'use', false, 24], [66, 'use', true, 24], [14, 'use', false, 32], [67, 'use', true, 32]]) {
      this.def(n, t, rep, (l) => this.doPlat(l, 'raiseAndChange', amount));
    }
    for (const [n, rep] of [[53, false], [87, true]]) this.def(n, 'walk', rep, (l) => this.doPlat(l, 'perpetual'));
    for (const [n, rep] of [[54, false], [89, true]]) this.def(n, 'walk', rep, (l) => this.stopPlat(l));
    // ----- 천장 · 크러셔 -----
    const ceil = (type, list) => { for (const [n, t, rep] of list) this.def(n, t, rep, (l) => this.doCeiling(l, type)); };
    ceil('lowerToFloor', [[41, 'use', false], [43, 'use', true]]);
    ceil('raiseToHighest', [[40, 'walk', false]]);   // 원작은 바닥도 내리려 하지만 같은 섹터라 천장만 움직인다
    ceil('lowerAndCrush', [[44, 'walk', false], [72, 'walk', true]]);
    ceil('crushAndRaise', [[25, 'walk', false], [73, 'walk', true], [49, 'use', false]]);
    ceil('fastCrushAndRaise', [[6, 'walk', false], [77, 'walk', true]]);
    ceil('silentCrushAndRaise', [[141, 'walk', false]]);
    for (const [n, rep] of [[57, false], [74, true]]) this.def(n, 'walk', rep, (l) => this.stopCeiling(l));
    // ----- 열쇠가 있어야 여는 고속문 (스위치) -----
    for (const [n, rep, key] of [[133, false, 'blue'], [99, true, 'blue'], [135, false, 'red'], [134, true, 'red'], [137, false, 'yellow'], [136, true, 'yellow']]) {
      this.def(n, 'use', rep, (l) => this.lockedDoor(l, key));
    }
    // ----- 조명 -----
    this.def(17, 'walk', false, (l) => { for (const s of this.sectorsWithTag(l.tag)) if (!s.specialData) g.add(new Strobe(g, s, 35, false)); return true; });
    this.def(104, 'walk', false, (l) => { for (const s of this.sectorsWithTag(l.tag)) s.light = minSurroundingLight(s, s.light); return true; });
  }

  // ---------- 레벨 시작 시 ----------
  /** 섹터 특수(조명 효과, 비밀 구역 수)와 스크롤 벽 생성 */
  spawn() {
    const g = this.game;
    for (const sec of this.level.sectors) {
      switch (sec.special) {
        case 1: g.add(new LightFlash(g, sec)); break;
        case 2: g.add(new Strobe(g, sec, 15, false)); break;
        case 3: g.add(new Strobe(g, sec, 35, false)); break;
        case 4: g.add(new Strobe(g, sec, 15, false)); break;
        case 8: g.add(new Glow(sec)); break;
        case 9: g.secretsTotal++; break;
        case 12: g.add(new Strobe(g, sec, 35, true)); break;
        case 13: g.add(new Strobe(g, sec, 15, true)); break;
        case 17: g.add(new FireFlicker(g, sec)); break;
        case 10: {   // 30초 뒤 닫히는 문
          const d = g.add(new Door(g, sec, 'normal', 0, VDOORSPEED, sec.ceilingHeight));
          d.countdown = 30 * 35; sec.special = 0;
          break;
        }
        case 14: {   // 5분 뒤 열리는 문
          const d = g.add(new Door(g, sec, 'raiseIn5Mins', 2, VDOORSPEED, lowestCeilingSurrounding(sec) - 4));
          d.countdown = 5 * 60 * 35; sec.special = 0;
          break;
        }
      }
    }
    for (const ld of this.level.linedefs) if (ld.special === 48) g.add(new WallScroll(ld));
  }

  sectorsWithTag(tag) { return this.level.sectors.filter((s) => s.tag === tag); }

  // ---------- 플레이어 접촉 ----------
  /** 플레이어가 서 있는 섹터의 특수 효과 (데미지 바닥, 비밀 구역) */
  playerInSpecialSector(p) {
    const sec = p.sector, g = this.game;
    if (!sec.special || p.z !== sec.floorHeight) return;
    const hit = (n) => { if ((g.time & 31) === 0) p.damage(n, g); };
    const suit = p.powers.radsuit > 0; // 방사능복: 독극물 데미지 면제 (가끔 새어 들어오는 건 원작과 같음)
    switch (sec.special) {
      case 5: if (!suit) hit(10); break;
      case 7: if (!suit) hit(5); break;
      case 4: case 16: if (!suit || g.rnd() % 256 < 5) hit(20); break;
      case 9:
        g.secretsFound++; sec.special = 0; g.say(t('game.secret'));
        break;
      case 11:
        hit(20);
        if (p.health <= 10) g.exitLevel(false);
        break;
    }
  }

  /** 이번 tic 에 (ox,oy)→who(플레이어 또는 몬스터) 현재 위치로 가로지른 특수 선 발동 (걷기) */
  crossLines(who, ox, oy) {
    const player = who === this.game.player, crossed = [];
    this.game.blockmap.forEachLine(Math.min(ox, who.x) - 1, Math.min(oy, who.y) - 1, Math.max(ox, who.x) + 1, Math.max(oy, who.y) + 1, (ld) => {
      if (!ld.special || (!player && !MONSTER_CROSS.has(ld.special))) return;
      if (Physics.intersect(ld, ox, oy, who.x, who.y) < 0) return;
      const oldSide = Physics.pointOnLineSide(ld, ox, oy);
      if (oldSide !== Physics.pointOnLineSide(ld, who.x, who.y)) crossed.push([ld, oldSide]);
    });
    for (const [ld, side] of crossed) this.activate(ld, side, 'walk', who);
  }

  /** 사용 키: 정면 64 유닛 안에서 가장 가까운 특수 선 작동 */
  useLines(p) {
    const x2 = p.x + Math.cos(p.angle) * 64, y2 = p.y + Math.sin(p.angle) * 64;
    const hits = [];
    this.game.blockmap.forEachLine(Math.min(p.x, x2), Math.min(p.y, y2), Math.max(p.x, x2), Math.max(p.y, y2), (ld) => {
      const t = Physics.intersect(ld, p.x, p.y, x2, y2);
      if (t >= 0) hits.push([t, ld]);
    });
    hits.sort((a, b) => a[0] - b[0]);

    for (const [, ld] of hits) {
      if (!ld.special) {
        if (!ld.backSector) { this.game.playSound('NOWAY'); return; } // 벽은 사용을 막는다
        const open = Math.min(ld.frontSector.ceilingHeight, ld.backSector.ceilingHeight)
          - Math.max(ld.frontSector.floorHeight, ld.backSector.floorHeight);
        if (open <= 0) { this.game.playSound('NOWAY'); return; } // 닫힌 문 같은 것도 막는다
        continue;                    // 열린 양면선은 통과
      }
      const side = Physics.pointOnLineSide(ld, p.x, p.y);
      if (side === 1) return;        // 뒷면에서는 작동 안 함
      this.activate(ld, side, 'use');
      return;                        // 특수 선 하나만
    }
  }

  /** 몬스터가 문을 연다: 열쇠 없는 일반 문(특수 1)만. 열렸으면 true */
  monsterUse(ld, monster) {
    if (ld.special !== 1 || (ld.flags & LINE_FLAGS.SECRET)) return false;
    const before = ld.backSector?.specialData;
    this.manualDoor(ld, monster);
    return !before && !!ld.backSector?.specialData;
  }

  /** 총알이 맞으면 작동하는 선 (G1 열기 46 등). 특수 46: 문을 열어 둔다 */
  shootLine(ld, shooter) {
    if (ld.special === 46 && this.doDoor(ld, 'open')) this.swapSwitchTextures(ld); // 반복 작동(GR): 선은 그대로 둔다
    else if (ld.special === 24 && this.doFloor(ld, 'raiseFloor')) { this.swapSwitchTextures(ld); ld.special = 0; }
    else if (ld.special === 47 && this.doPlat(ld, 'raiseToNearestAndChange')) { this.swapSwitchTextures(ld); ld.special = 0; }
  }

  // ---------- 발동 ----------
  activate(ld, side, how, who = this.game.player) {
    if (how === 'use' && MANUAL_DOORS.has(ld.special)) { this.manualDoor(ld); return; }
    const def = this.table.get(ld.special);
    if (!def || def.trigger !== how) return;
    if (how === 'use' && ld.buttonActive) return;
    const ok = def.action(ld, side, who);
    if (!ok) return;
    if (how === 'use') {
      this.game.playSound(ld.special === 11 || ld.special === 51 ? 'SWTCHX' : 'SWTCHN', { x: (ld.v1.x + ld.v2.x) / 2, y: (ld.v1.y + ld.v2.y) / 2 });
      this.swapSwitchTextures(ld);
      if (def.repeat) this.game.add(new ButtonTimer(this, ld));
    }
    if (!def.repeat) ld.special = 0;
  }

  /** SW1xxx ↔ SW2xxx */
  swapSwitchTextures(ld) {
    const s = ld.right;
    if (!s) return;
    const flip = (n) => (n.startsWith('SW1') ? `SW2${n.slice(3)}` : n.startsWith('SW2') ? `SW1${n.slice(3)}` : n);
    s.upperTex = flip(s.upperTex); s.midTex = flip(s.midTex); s.lowerTex = flip(s.lowerTex);
    s.tex = null; // 렌더러의 텍스처 캐시 무효화
  }

  // ---------- 문 ----------
  /** 사용 키로 여는 문 (선의 뒤쪽 섹터가 문) */
  manualDoor(ld, by = null) {
    const g = this.game, p = g.player;
    const monster = by && by !== p;   // 몬스터는 열쇠 없는 일반 문만 열고, 닫지는 않는다
    const key = KEY_DOORS[ld.special];
    if (key && (monster || !p.keys[key])) { if (!monster) { g.say(t('game.needKeyDoor', { key: t(`key.${key}`) })); g.playSound('OOF'); } return; }

    const sec = ld.backSector;
    if (!sec) return;
    const sp = ld.special;
    if (sec.specialData instanceof Door) {
      if (!monster && [1, 26, 27, 28, 117].includes(sp)) { sec.specialData.direction = sec.specialData.direction === -1 ? 1 : -1; sec.specialData.sound(); }
      return;
    }
    if (sec.specialData) return;
    const blaze = sp === 117 || sp === 118;
    const open = [31, 32, 33, 34, 118].includes(sp);
    g.add(new Door(g, sec, open ? (blaze ? 'blazeOpen' : 'open') : (blaze ? 'blazeRaise' : 'normal'), 1,
      VDOORSPEED * (blaze ? 4 : 1), lowestCeilingSurrounding(sec) - 4));
    if (open) ld.special = 0;
  }

  /** 태그가 같은 섹터의 문을 움직임 */
  doDoor(ld, type) {
    let did = false;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      const blaze = type.startsWith('blaze');
      const speed = VDOORSPEED * (blaze ? 4 : 1);
      const top = lowestCeilingSurrounding(sec) - 4;
      let dir = 1, topHeight = top;
      if (type === 'close' || type === 'blazeClose') dir = -1;
      else if (type === 'close30ThenOpen') { dir = -1; topHeight = sec.ceilingHeight; }
      this.game.add(new Door(this.game, sec, type, dir, speed, topHeight));
    }
    return did;
  }

  /** 열쇠 고속문 스위치 (99, 133~137): 열쇠가 없으면 메시지만 */
  lockedDoor(ld, key) {
    const g = this.game;
    if (!g.player.keys[key]) { g.say(t('game.needKeyObject', { key: t(`key.${key}`) })); g.playSound('OOF'); return false; }
    return this.doDoor(ld, 'blazeOpen');
  }

  // ---------- 리프트 ----------
  /** amount: raiseAndChange 에서 올라가는 높이 (24 / 32) */
  doPlat(ld, type, amount = 0) {
    let did = false;
    if (type === 'perpetual') did = this.activateStopped(ld.tag, Plat);   // 멈춰 둔 것이 있으면 다시 움직인다
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      let plat;
      if (type === 'raiseAndChange') {
        plat = new Plat(this.game, sec, type, PLATSPEED / 2, sec.floorHeight, sec.floorHeight + amount, 0, 'up');
        sec.floorTex = ld.frontSector.floorTex; sec.floorFlat = null;
      } else if (type === 'perpetual') {
        const low = Math.min(lowestFloorSurrounding(sec), sec.floorHeight), high = Math.max(highestFloorSurrounding(sec), sec.floorHeight);
        plat = new Plat(this.game, sec, type, PLATSPEED, low, high, PLATWAIT, this.game.rnd() & 1 ? 'down' : 'up');
      } else if (type === 'raiseToNearestAndChange') {
        plat = new Plat(this.game, sec, type, PLATSPEED / 2, sec.floorHeight, nextHighestFloor(sec, sec.floorHeight), 0, 'up');
        sec.floorTex = ld.frontSector.floorTex; sec.floorFlat = null; // 바닥 무늬 교체
        sec.special = 0;
      } else {
        const low = Math.min(lowestFloorSurrounding(sec), sec.floorHeight);
        plat = new Plat(this.game, sec, type, PLATSPEED * (type === 'blazeDWUS' ? 8 : 4), low, sec.floorHeight, PLATWAIT, 'down');
      }
      this.game.add(plat);
    }
    return did;
  }

  /** 멈춤 선(54·89): 태그가 같은 영구 리프트를 그 자리에 세운다 */
  stopPlat(ld) {
    for (const t of this.game.thinkers) {
      if (t instanceof Plat && t.sector.tag === ld.tag && t.status !== 'stasis') { t.oldStatus = t.status; t.status = 'stasis'; }
    }
    return true;
  }

  /** 멈춰 둔(stasis) 리프트·크러셔 중 태그가 같은 것을 다시 움직인다. 하나라도 있으면 true */
  activateStopped(tag, Kind) {
    let any = false;
    for (const t of this.game.thinkers) {
      if (!(t instanceof Kind) || t.tag !== tag && t.sector.tag !== tag) continue;
      if (Kind === Plat && t.status === 'stasis') { t.status = t.oldStatus; any = true; }
      if (Kind === Ceiling && t.direction === 0 && t.oldDirection) { t.direction = t.oldDirection; any = true; }
    }
    return any;
  }

  // ---------- 천장 · 크러셔 ----------
  doCeiling(ld, type) {
    const crusher = type === 'crushAndRaise' || type === 'fastCrushAndRaise' || type === 'silentCrushAndRaise';
    let did = crusher && this.activateStopped(ld.tag, Ceiling);
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      const g = this.game, floor = sec.floorHeight;
      let c;
      if (type === 'raiseToHighest') c = new Ceiling(g, sec, type, 1, CEILSPEED, floor, highestCeilingSurrounding(sec), false);
      else {
        const bottom = type === 'lowerToFloor' ? floor : floor + 8;
        c = new Ceiling(g, sec, type, -1, type === 'fastCrushAndRaise' ? CEILSPEED * 2 : CEILSPEED, bottom, sec.ceilingHeight, type !== 'lowerToFloor');
      }
      g.add(c);
    }
    return did;
  }

  /** 멈춤 선(57·74): 태그가 같은 크러셔를 그 자리에 세운다 */
  stopCeiling(ld) {
    let did = false;
    for (const t of this.game.thinkers) {
      if (t instanceof Ceiling && t.tag === ld.tag && t.direction !== 0) { t.oldDirection = t.direction; t.direction = 0; did = true; }
    }
    return did;
  }

  // ---------- 바닥 ----------
  doFloor(ld, type) {
    let did = false;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      let dir = -1, speed = FLOORSPEED, dest = sec.floorHeight, change = null, crush = false;
      switch (type) {
        case 'lowerFloor': dest = highestFloorSurrounding(sec); break;
        case 'lowerFloorToLowest': dest = lowestFloorSurrounding(sec); break;
        case 'turboLower':
          speed = FLOORSPEED * 4; dest = highestFloorSurrounding(sec);
          if (dest !== sec.floorHeight) dest += 8;
          break;
        case 'raiseFloor':
          dir = 1; dest = Math.min(lowestCeilingSurrounding(sec), sec.ceilingHeight); break;
        case 'raiseFloorToNearest':
          dir = 1; dest = nextHighestFloor(sec, sec.floorHeight); break;
        case 'raiseFloorTurbo':
          dir = 1; speed = FLOORSPEED * 4; dest = nextHighestFloor(sec, sec.floorHeight); break;
        case 'raiseFloorCrush':
          dir = 1; crush = true; dest = Math.min(lowestCeilingSurrounding(sec), sec.ceilingHeight) - 8; break;
        case 'raiseFloor24': dir = 1; dest = sec.floorHeight + 24; break;
        case 'raiseFloor512': dir = 1; dest = sec.floorHeight + 512; break;
        case 'raiseFloor24AndChange':   // 무늬·특수는 바로 선 앞쪽 섹터 것으로
          dir = 1; dest = sec.floorHeight + 24;
          sec.floorTex = ld.frontSector.floorTex; sec.floorFlat = null; sec.special = ld.frontSector.special;
          break;
        case 'raiseToTexture':
          dir = 1; dest = sec.floorHeight + shortestLowerTexture(sec, this.level.textureHeights ?? new Map()); break;
        case 'lowerAndChange': {   // 내려간 높이와 같은 이웃 바닥의 무늬·특수로 바뀐다
          dest = lowestFloorSurrounding(sec);
          const model = sec.lines.map((l) => nextSector(l, sec)).find((o) => o && o.floorHeight === dest);
          change = { tex: model?.floorTex ?? sec.floorTex, special: model ? model.special : sec.special };
          break;
        }
      }
      this.game.add(new FloorMover(this.game, sec, dir, speed, dest, change, crush));
    }
    return did;
  }

  /** 도넛 (원작 EV_DoDonut): s1 = 가운데, s2 = 둘러싼 링, s3 = 링 바깥 */
  doDonut(ld) {
    let did = false;
    for (const s1 of this.sectorsWithTag(ld.tag)) {
      if (s1.specialData) continue;
      did = true;
      const s2 = s1.lines.map((l) => nextSector(l, s1)).find(Boolean);
      if (!s2) continue;
      const ring = s2.lines.find((l) => l.backSector && l.backSector !== s1 && l.frontSector === s2);
      const s3 = ring?.backSector ?? s2.lines.map((l) => nextSector(l, s2)).find((o) => o && o !== s1);
      if (!s3) continue;
      this.game.add(new FloorMover(this.game, s2, 1, FLOORSPEED / 2, s3.floorHeight, { tex: s3.floorTex, special: s3.special }));
      this.game.add(new FloorMover(this.game, s1, -1, FLOORSPEED / 2, s3.floorHeight));
    }
    return did;
  }

  /** 계단: 같은 바닥 무늬로 이어진 섹터를 차례로 step 씩 높게 올림 */
  buildStairs(ld, step, speed) {
    let did = false;
    for (let sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      let height = sec.floorHeight + step;
      this.game.add(new FloorMover(this.game, sec, 1, speed, height));
      const tex = sec.floorTex;
      for (let found = true; found;) {
        found = false;
        for (const l of sec.lines) {
          if (!(l.flags & LINE_FLAGS.TWO_SIDED) || l.frontSector !== sec) continue;
          const next = l.backSector;
          if (next.floorTex !== tex) continue;
          height += step;
          if (next.specialData) continue;
          sec = next;
          this.game.add(new FloorMover(this.game, sec, 1, speed, height));
          found = true;
          break;
        }
      }
    }
    return did;
  }

  // ---------- 조명 ----------
  setLights(tag, value) {
    for (const sec of this.sectorsWithTag(tag)) sec.light = value === 'brightest' ? maxSurroundingLight(sec) : value;
    return true;
  }

  // ---------- 텔레포트 ----------
  /**
   * who(플레이어/몬스터)를 태그가 같은 섹터의 텔레포트 도착 지점(thing 14)으로 옮긴다 (원작 EV_Teleport + P_TeleportMove).
   * 도착 지점에 서 있는 것은 플레이어가 밟아 죽이고(텔레프래그), 몬스터는 남이 서 있으면 실패한다.
   * 출발·도착 지점에 안개(TFOG)와 소리가 난다.
   */
  teleport(ld, side, who = this.game.player) {
    if (side === 1) return false;
    const g = this.game, isPlayer = who === g.player;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      const dest = this.level.things.find((t) => t.type === 14 && sectorAt(this.level, t.x, t.y) === sec);
      if (!dest) continue;
      const near = (m) => Math.abs(m.x - dest.x) < m.radius + who.radius && Math.abs(m.y - dest.y) < m.radius + who.radius;
      const victims = g.shootables.filter((m) => m !== who && !m.removed && near(m));
      if (victims.length && !isPlayer) return false;
      for (const v of victims) damageMobj(g, v, who, who, 10000);

      const ox = who.x, oy = who.y, oz = who.z, angle = (dest.angle * Math.PI) / 180;
      g.spawnKind('tfog', ox, oy, oz);
      g.playSound('TELEPT', { x: ox, y: oy });
      if (isPlayer) who.teleportTo(g, dest.x, dest.y, angle);
      else this.teleportMobj(who, dest.x, dest.y, angle);
      g.spawnKind('tfog', dest.x + 20 * Math.cos(angle), dest.y + 20 * Math.sin(angle), sec.floorHeight);
      g.playSound('TELEPT', { x: dest.x, y: dest.y });
      return true;
    }
    return false;
  }

  teleportMobj(m, x, y, angle) {
    m.x = x; m.y = y; m.angle = angle;
    m.momx = m.momy = m.momz = 0;
    m.sector = sectorAt(this.level, x, y);
    m.floorz = m.z = m.sector.floorHeight; m.ceilz = m.sector.ceilingHeight;
  }
}

import { sectorAt } from '../render/bsp.js';
import { LINE_FLAGS } from '../wad/level.js';
import { Physics } from './physics.js';
import {
  lowestFloorSurrounding, highestFloorSurrounding, nextHighestFloor, lowestCeilingSurrounding,
  minSurroundingLight, maxSurroundingLight,
} from './sectors.js';

/**
 * 특수 효과 (원작 p_spec.c, p_doors.c, p_plats.c, p_floor.c, p_lights.c, p_switch.c 를 단순화).
 *  - thinker: 매 tic(1/35초) tick() 을 호출받는 움직이는 것들. true 를 돌려주면 제거된다.
 *  - 선 특수 효과 번호 → { 발동 방식(걷기/사용), 반복 여부, 동작 } 표.
 * 아직 안 한 것: 총으로 작동하는 선(G1/GR), 크러셔, 도넛, 영구 리프트.
 */
const OK = 0, CRUSHED = 1, PASTDEST = 2;
const VDOORSPEED = 2, VDOORWAIT = 150;
const PLATSPEED = 1, PLATWAIT = 105; // 35 tic × 3초
const FLOORSPEED = 1;
const BUTTONTIME = 35;
const rnd = () => (Math.random() * 256) | 0;

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

// ---------- thinker: 문 ----------
class Door {
  /** type: normal | close | open | close30ThenOpen | blazeRaise | blazeOpen | blazeClose */
  constructor(game, sec, type, direction, speed, topHeight) {
    this.game = game; this.sector = sec; this.type = type;
    this.direction = direction; this.speed = speed; this.topHeight = topHeight;
    this.countdown = 0;
    sec.specialData = this;
  }

  tick() {
    const { game, sector: sec, type } = this;
    switch (this.direction) {
      case 0: // 위에서 대기
        if (--this.countdown === 0) {
          if (type === 'normal' || type === 'blazeRaise') this.direction = -1;
          else if (type === 'close30ThenOpen') this.direction = 1;
        }
        break;
      case -1: { // 닫히는 중
        const res = movePlane(game, sec, this.speed, sec.floorHeight, false, true, -1);
        if (res === PASTDEST) {
          if (type === 'close30ThenOpen') { this.direction = 0; this.countdown = 35 * 30; }
          else { sec.specialData = null; return true; }
        } else if (res === CRUSHED && type !== 'blazeClose' && type !== 'close') {
          this.direction = 1; // 뭔가 끼면 다시 열림
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
  /** type: downWaitUpStay | blazeDWUS | raiseToNearestAndChange */
  constructor(game, sec, type, speed, low, high, wait, status) {
    this.game = game; this.sector = sec; this.type = type;
    this.speed = speed; this.low = low; this.high = high; this.wait = wait;
    this.status = status; this.count = 0;
    sec.specialData = this;
  }

  tick() {
    const { game, sector: sec } = this;
    switch (this.status) {
      case 'up': {
        const res = movePlane(game, sec, this.speed, this.high, false, false, 1);
        if (res === CRUSHED) { this.count = this.wait; this.status = 'down'; }
        else if (res === PASTDEST) {
          this.count = this.wait; this.status = 'waiting';
          if (this.type !== 'perpetual') { sec.specialData = null; return true; }
        }
        break;
      }
      case 'down': {
        const res = movePlane(game, sec, this.speed, this.low, false, false, -1);
        if (res === PASTDEST) { this.count = this.wait; this.status = 'waiting'; }
        break;
      }
      case 'waiting':
        if (--this.count <= 0) this.status = sec.floorHeight === this.low ? 'up' : 'down';
        break;
    }
    return false;
  }
}

// ---------- thinker: 바닥 ----------
class FloorMover {
  constructor(game, sec, direction, speed, dest) {
    this.game = game; this.sector = sec; this.direction = direction; this.speed = speed; this.dest = dest;
    sec.specialData = this;
  }

  tick() {
    const res = movePlane(this.game, this.sector, this.speed, this.dest, false, false, this.direction);
    if (res === PASTDEST) { this.sector.specialData = null; return true; }
    return false;
  }
}

// ---------- thinker: 조명 ----------
class LightFlash { // 불규칙 깜빡임 (섹터 특수 1)
  constructor(sec) {
    this.sec = sec; this.max = sec.light; this.min = minSurroundingLight(sec, sec.light);
    this.count = (rnd() & 64) + 1;
  }
  tick() {
    if (--this.count > 0) return false;
    if (this.sec.light === this.max) { this.sec.light = this.min; this.count = (rnd() & 7) + 1; }
    else { this.sec.light = this.max; this.count = (rnd() & 64) + 1; }
    return false;
  }
}

class Strobe { // 일정한 점멸 (섹터 특수 2, 3, 4, 12, 13)
  constructor(sec, darkTime, inSync) {
    this.sec = sec; this.darkTime = darkTime; this.brightTime = 5;
    this.max = sec.light;
    this.min = minSurroundingLight(sec, sec.light);
    if (this.min === this.max) this.min = 0;
    this.count = inSync ? 1 : (rnd() & 7) + 1;
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
  constructor(sec) { this.sec = sec; this.max = sec.light; this.min = minSurroundingLight(sec, sec.light) + 16; this.count = 4; }
  tick() {
    if (--this.count > 0) return false;
    const amount = (rnd() & 3) * 16;
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
    this.def(39, 'walk', false, (l, side) => this.teleport(l, side));
    this.def(97, 'walk', true, (l, side) => this.teleport(l, side));
  }

  // ---------- 레벨 시작 시 ----------
  /** 섹터 특수(조명 효과, 비밀 구역 수)와 스크롤 벽 생성 */
  spawn() {
    const g = this.game;
    for (const sec of this.level.sectors) {
      switch (sec.special) {
        case 1: g.add(new LightFlash(sec)); break;
        case 2: g.add(new Strobe(sec, 15, false)); break;
        case 3: g.add(new Strobe(sec, 35, false)); break;
        case 4: g.add(new Strobe(sec, 15, false)); break;
        case 8: g.add(new Glow(sec)); break;
        case 9: g.secretsTotal++; break;
        case 12: g.add(new Strobe(sec, 35, true)); break;
        case 13: g.add(new Strobe(sec, 15, true)); break;
        case 17: g.add(new FireFlicker(sec)); break;
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
      case 4: case 16: if (!suit || rnd() < 5) hit(20); break;
      case 9:
        g.secretsFound++; sec.special = 0; g.say('A secret is revealed!');
        break;
      case 11:
        hit(20);
        if (p.health <= 10) g.exitLevel(false);
        break;
    }
  }

  /** 이번 tic 에 (ox,oy)→플레이어 현재 위치로 가로지른 특수 선 발동 (걷기) */
  crossLines(p, ox, oy) {
    const crossed = [];
    this.game.blockmap.forEachLine(Math.min(ox, p.x) - 1, Math.min(oy, p.y) - 1, Math.max(ox, p.x) + 1, Math.max(oy, p.y) + 1, (ld) => {
      if (!ld.special) return;
      if (Physics.intersect(ld, ox, oy, p.x, p.y) < 0) return;
      const oldSide = Physics.pointOnLineSide(ld, ox, oy);
      if (oldSide !== Physics.pointOnLineSide(ld, p.x, p.y)) crossed.push([ld, oldSide]);
    });
    for (const [ld, side] of crossed) this.activate(ld, side, 'walk');
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
        if (!ld.backSector) return; // 벽은 사용을 막는다
        const open = Math.min(ld.frontSector.ceilingHeight, ld.backSector.ceilingHeight)
          - Math.max(ld.frontSector.floorHeight, ld.backSector.floorHeight);
        if (open <= 0) return;       // 닫힌 문 같은 것도 막는다
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
  }

  // ---------- 발동 ----------
  activate(ld, side, how) {
    if (how === 'use' && MANUAL_DOORS.has(ld.special)) { this.manualDoor(ld); return; }
    const def = this.table.get(ld.special);
    if (!def || def.trigger !== how) return;
    if (how === 'use' && ld.buttonActive) return;
    const ok = def.action(ld, side);
    if (!ok) return;
    if (how === 'use') {
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
    if (key && (monster || !p.keys[key])) { if (!monster) g.say(`You need a ${key} key to open this door.`); return; }

    const sec = ld.backSector;
    if (!sec) return;
    const sp = ld.special;
    if (sec.specialData instanceof Door) {
      if (!monster && [1, 26, 27, 28, 117].includes(sp)) sec.specialData.direction = sec.specialData.direction === -1 ? 1 : -1;
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

  // ---------- 리프트 ----------
  doPlat(ld, type) {
    let did = false;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      let plat;
      if (type === 'raiseToNearestAndChange') {
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

  // ---------- 바닥 ----------
  doFloor(ld, type) {
    let did = false;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      if (sec.specialData) continue;
      did = true;
      let dir = -1, speed = FLOORSPEED, dest = sec.floorHeight;
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
      }
      this.game.add(new FloorMover(this.game, sec, dir, speed, dest));
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
  teleport(ld, side) {
    if (side === 1) return false;
    const g = this.game, p = g.player;
    for (const sec of this.sectorsWithTag(ld.tag)) {
      const dest = this.level.things.find((t) => t.type === 14 && sectorAt(this.level, t.x, t.y) === sec);
      if (!dest) continue;
      p.teleportTo(g, dest.x, dest.y, (dest.angle * Math.PI) / 180);
      return true;
    }
    return false;
  }
}

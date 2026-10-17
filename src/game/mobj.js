import { sectorAt } from '../render/bsp.js';
import { THING_INFO, INVISIBLE_THINGS, countsKill } from './info.js';
import { AI } from './states.js';

/**
 * 맵 위의 물체 하나 (아이템, 장식, 몬스터, 투사체, 효과).
 *  - ai 가 있으면 상태 표(states.js)로 움직이고, 없으면 단순 프레임 반복(장식·아이템)
 *  - 상태 진입 시 동작(action)이 실행된다 (원작과 같은 규칙)
 */
export class Mobj {
  /** info: THING_INFO 항목 또는 효과/투사체용 { sprite, ai, ... } */
  constructor(type, info, x, y, angle, sector) {
    this.type = type; this.info = info;
    this.x = x; this.y = y; this.angle = angle;
    this.spawnX = x; this.spawnY = y; this.spawnAngle = angle; this.spawnAmbush = false;   // 악몽 난이도 부활 자리
    this.sector = sector;
    this.radius = info.radius; this.height = info.height;
    this.solid = info.solid; this.pickup = info.pickup; this.fuzz = info.fuzz;
    this.removed = false; this.hidden = false;
    this.sprite = info.sprite;
    this.momx = 0; this.momy = 0; this.momz = 0;

    // ----- 전투 상태 -----
    this.ai = info.ai ? AI[info.ai] : null;
    this.shootable = !!info.shootable;
    this.health = this.ai?.hp ?? 0;
    this.maxHealth = this.health;
    this.target = null;          // 쫓거나 공격할 대상
    this.moveDir = 8;            // 0..7 = E,NE,N,NW,W,SW,S,SE / 8 = 없음
    this.moveCount = 0;
    this.reaction = this.ai?.reaction ?? 0;
    this.threshold = 0;          // 한 대상에 집중하는 시간
    this.justHit = false; this.justAttacked = false;
    this.ambush = false;
    this.corpse = false;
    this.dropped = false;        // 몬스터가 떨어뜨린 아이템 (탄약이 절반)
    this.missile = false; this.owner = null; this.damageScale = 0;
    this.stateLabel = null; this.stateIndex = 0;
    this.floorz = sector.floorHeight; this.ceilz = sector.ceilingHeight;

    if (this.ai) this.initAi(info);
    else { this.seqIndex = 0; this.setFrame(0); }
    this.z = this.restingZ();
  }

  initAi(info) {
    const ai = this.ai;
    if (ai.missile && typeof ai.missile === 'object') {   // 투사체
      this.missile = true; this.speed = ai.missile.speed; this.damageScale = ai.missile.damage;
      this.sprite = ai.sprite;
    }
    if (ai.effect) { this.sprite = ai.sprite; this.hidden = false; }
    this.floating = !!ai.float;   // 카코데몬·로스트 소울: 중력 없이 떠다닌다
    this.skullFly = false;        // 로스트 소울이 돌진하는 중
    this.setStateNoAction(ai.states.stand ? 'stand' : 'fly');
  }

  /** 서 있는 높이: 바닥 위 / 천장에 매달린 것은 천장 아래 */
  restingZ() {
    return this.info.ceiling ? this.sector.ceilingHeight - this.height : this.sector.floorHeight;
  }

  // ---------- 단순 프레임 반복 (장식·아이템) ----------
  setFrame(i) {
    const { seq, tics, bright } = this.info;
    this.seqIndex = i;
    const letter = seq[i];
    this.frame = letter.charCodeAt(0) - 65;
    this.bright = bright === true || (typeof bright === 'string' && bright.includes(letter));
    this.tics = Array.isArray(tics) ? tics[i] : tics;
  }

  // ---------- 상태 머신 (몬스터·투사체·효과) ----------
  /** 첫 상태로 들어가되 동작은 실행하지 않음 (생성 직후: 아직 game 이 없을 수 있음) */
  setStateNoAction(label, index = 0) {
    this.stateLabel = label; this.stateIndex = index;
    const s = this.ai.states[label][index];
    this.frame = s.f.charCodeAt(0) - 65; this.bright = s.b; this.tics = s.t;
  }

  setState(label, game, index = 0) {
    this.stateLabel = label; this.stateIndex = index;
    const s = this.ai.states[label][index];
    this.frame = s.f.charCodeAt(0) - 65; this.bright = s.b; this.tics = s.t;
    // 악몽 난이도: 몬스터의 추적/공격/고통 동작이 두 배 빠르다
    if (game.skill === 5 && this.tics > 1 && (label === 'run' || label === 'attack' || label === 'pain')) this.tics >>= 1;
    if (s.a) game.actions[s.a]?.(this, game);
  }

  /** 지금 상태가 이 라벨인가 */
  is(label) { return this.stateLabel === label; }

  advance(game) {
    const list = this.ai.states[this.stateLabel];
    if (this.stateIndex + 1 < list.length) { this.setState(this.stateLabel, game, this.stateIndex + 1); return; }
    const next = this.ai.after?.[this.stateLabel];
    if (next === 'remove') game.removeMobj(this);
    else if (next) this.setState(next, game);
    else this.tics = -1;
  }

  /** 한 tic */
  tick(game) {
    if (!this.ai) {
      if (this.info.seq.length > 1 && --this.tics <= 0) this.setFrame((this.seqIndex + 1) % this.info.seq.length);
      this.z = this.restingZ();
      return;
    }
    game.moveMobj(this);
    if (this.removed) return;
    if (this.tics !== -1) { if (--this.tics <= 0) this.advance(game); }
    else if (this.corpse && countsKill(this.info) && game.skill === 5) game.nightmareRespawn(this);   // 악몽: 시체가 다시 일어난다
  }
}

/** 투사체/효과 종류(states.js 의 키)로 Mobj 생성용 info 를 만든다 */
export const kindInfo = (kind) => {
  const ai = AI[kind];
  return {
    sprite: ai.sprite, ai: kind, radius: ai.radius ?? 0, height: ai.height ?? 0,
    solid: false, pickup: null, fuzz: false, shootable: false, ceiling: false, seq: 'A', tics: 1, bright: false, name: kind,
  };
};

/** 난이도 플래그: 1 = 쉬움(스킬 1·2), 2 = 보통(3), 4 = 어려움(4·5), 8 = 매복, 16 = 멀티플레이 전용 */
const skillBit = (skill) => (skill <= 2 ? 1 : skill === 3 ? 2 : 4);

/** 맵의 THINGS 에서 그릴/상호작용할 물체 생성. 알 수 없는 종류는 따로 돌려줘 확인할 수 있게 한다 */
export function spawnMobjs(level, skill = 3) {
  const mobjs = [], unknown = new Map();
  for (const t of level.things) {
    if (INVISIBLE_THINGS.has(t.type)) continue;
    const info = THING_INFO[t.type];
    if (!info) { unknown.set(t.type, (unknown.get(t.type) || 0) + 1); continue; }
    if (!(t.flags & skillBit(skill)) || (t.flags & 16)) continue;
    const m = new Mobj(t.type, info, t.x, t.y, (t.angle * Math.PI) / 180, sectorAt(level, t.x, t.y));
    if (t.flags & 8) m.ambush = m.spawnAmbush = true;
    mobjs.push(m);
  }
  return { mobjs, unknown };
}

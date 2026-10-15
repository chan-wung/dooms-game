import { sectorAt } from '../render/bsp.js';
import { THING_INFO, INVISIBLE_THINGS } from './info.js';

/** 맵 위의 물체 하나 (아이템, 장식, 몬스터 …). 스프라이트로 그려진다 */
export class Mobj {
  constructor(type, info, x, y, angle, sector) {
    this.type = type; this.info = info;
    this.x = x; this.y = y; this.angle = angle;
    this.sector = sector;
    this.radius = info.radius; this.height = info.height;
    this.solid = info.solid; this.pickup = info.pickup; this.fuzz = info.fuzz;
    this.removed = false;
    this.sprite = info.sprite;
    this.seqIndex = 0;
    this.setFrame(0);
    this.z = this.restingZ();
  }

  /** 서 있는 높이: 바닥 위 / 천장에 매달린 것은 천장 아래 */
  restingZ() {
    return this.info.ceiling ? this.sector.ceilingHeight - this.height : this.sector.floorHeight;
  }

  setFrame(i) {
    const { seq, tics, bright } = this.info;
    this.seqIndex = i;
    const letter = seq[i];
    this.frame = letter.charCodeAt(0) - 65;
    this.bright = bright === true || (typeof bright === 'string' && bright.includes(letter));
    this.tics = Array.isArray(tics) ? tics[i] : tics;
  }

  /** 한 tic: 프레임 애니메이션, 움직이는 바닥/천장 따라가기 */
  tick() {
    if (this.info.seq.length > 1 && --this.tics <= 0) this.setFrame((this.seqIndex + 1) % this.info.seq.length);
    this.z = this.restingZ();
  }
}

/** 난이도 플래그: 1 = 쉬움(스킬 1·2), 2 = 보통(3), 4 = 어려움(4·5), 16 = 멀티플레이 전용 */
const skillBit = (skill) => (skill <= 2 ? 1 : skill === 3 ? 2 : 4);

/** 맵의 THINGS 에서 그릴/상호작용할 물체 생성. 알 수 없는 종류는 목록으로 돌려줘 확인할 수 있게 한다 */
export function spawnMobjs(level, skill = 3) {
  const mobjs = [], unknown = new Map();
  for (const t of level.things) {
    if (INVISIBLE_THINGS.has(t.type)) continue;
    const info = THING_INFO[t.type];
    if (!info) { unknown.set(t.type, (unknown.get(t.type) || 0) + 1); continue; }
    if (!(t.flags & skillBit(skill)) || (t.flags & 16)) continue;
    mobjs.push(new Mobj(t.type, info, t.x, t.y, (t.angle * Math.PI) / 180, sectorAt(level, t.x, t.y)));
  }
  return { mobjs, unknown };
}

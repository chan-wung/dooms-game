import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { saveGame, loadGame } from '../src/game/savegame.js';
import { checkSight } from '../src/game/combat.js';
import { sectorAt } from '../src/render/bsp.js';

const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);

/** 정해진 규칙으로 만든 입력: 걷기, 돌기, 쏘기, 사용을 번갈아 */
const cmdAt = (t) => ({
  forward: t % 90 < 60 ? 50 : 0, side: t % 140 < 30 ? 24 : 0, turn: (t % 70 < 10 ? 0.02 : 0) * (t % 3 ? 1 : -1),
  use: t % 53 === 0, fire: t % 40 < 20, weapon: t % 250 === 249 ? 3 : 0, cycle: 0,
});
const run = (g, from, n) => { for (let t = from; t < from + n; t++) g.tick(cmdAt(t)); };

/** 상태 요약: 하나라도 다르면 문자열이 달라진다 */
const digest = (g) => JSON.stringify({
  t: g.time, rng: g.rng.state, kills: g.killsFound, items: g.itemsFound, secrets: g.secretsFound,
  p: [g.player.x, g.player.y, g.player.z, g.player.angle, g.player.health, g.player.armor, g.player.ammo, g.player.readyWeapon, g.player.dead],
  mobjs: g.mobjs.map((m) => [m.type, m.x, m.y, m.z, m.health, m.stateLabel, m.stateIndex, m.tics, m.removed]),
  sectors: g.level.sectors.map((s) => [s.floorHeight, s.ceilingHeight, s.light, s.floorTex, s.special]),
  lines: g.level.linedefs.map((l) => [l.special, l.right?.midTex, l.right?.xOffset]),
  thinkers: g.thinkers.length,
});

/** 몬스터가 보이는 위치에 플레이어를 세운다 */
const placeNearMonster = (g) => {
  const m = g.mobjs.find((o) => o.info.monster && !o.removed);
  if (!m) return false;
  for (const d of [200, 150, 260, 320]) for (let a = 0; a < 48; a++) {
    const ang = (a * Math.PI) / 24, x = m.x + Math.cos(ang) * d, y = m.y + Math.sin(ang) * d;
    const s = sectorAt(g.level, x, y);
    if (Math.abs(s.floorHeight - m.sector.floorHeight) > 8 || g.physics.check(x, y, s.floorHeight).blocked) continue;
    if (!checkSight(g, { x, y, z: s.floorHeight, height: 56 }, m)) continue;
    g.player.teleportTo(g, x, y, Math.atan2(m.y - y, m.x - x)); g.player.reaction = 0;
    return true;
  }
  return false;
};

// ---------- 1. 같은 시드·입력이면 결과가 같다 ----------
{
  const a = new Game(loadLevel(wad, 'E1M1'), 3, 5), c = new Game(loadLevel(wad, 'E1M1'), 3, 5);
  run(a, 0, 300); run(c, 0, 300);
  ok('결정성: 같은 시드·입력 → 같은 상태', digest(a) === digest(c));
}

// ---------- 2. 저장 → 불러오기 → 이어서 진행해도 원본과 똑같다 ----------
for (const [map, skill] of [['E1M1', 3], ['E1M2', 3], ['E1M3', 4], ['E1M8', 3]]) {
  const g = new Game(loadLevel(wad, map), skill, 9);
  placeNearMonster(g);
  // 문을 하나 열고(thinker), 조작하다가 저장
  const door = g.level.linedefs.find((l) => l.special === 1 && l.backSector);
  if (door) g.specials.activate(door, 0, 'use');
  run(g, 0, 250);

  const json = JSON.stringify(saveGame(g));
  const copy = loadGame(loadLevel(wad, map), skill, JSON.parse(json));
  ok(`${map}: 불러온 직후 상태가 저장 시점과 같다`, digest(copy) === digest(g));
  run(g, 250, 300); run(copy, 250, 300);
  ok(`${map}: 이어서 300 tic 진행해도 원본과 같다`, digest(copy) === digest(g),
    `(몬스터 ${g.mobjs.length}, thinker ${g.thinkers.length}, 저장 크기 ${(json.length / 1024).toFixed(0)}KB)`);
}

// ---------- 3. 한 번 더 저장해도 (저장 → 불러오기 → 저장) 내용이 같다 ----------
{
  const g = new Game(loadLevel(wad, 'E1M2'), 3, 2); placeNearMonster(g); run(g, 0, 200);
  const s1 = JSON.stringify(saveGame(g));
  const s2 = JSON.stringify(saveGame(loadGame(loadLevel(wad, 'E1M2'), 3, JSON.parse(s1))));
  ok('저장 → 불러오기 → 저장 이 같은 데이터', s1 === s2);
}

console.log(out.join('\n'));

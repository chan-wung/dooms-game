import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { Mobj } from '../src/game/mobj.js';
import { THING_INFO } from '../src/game/info.js';
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false, weapon: 0, cycle: 0 };
const mk = (skill, map = 'E1M1') => new Game(loadLevel(wad, map), skill, 3);
const pick = (g, type) => { let m = g.mobjs.find((o) => o.type === type); if (!m) { const p = g.player; m = new Mobj(type, THING_INFO[type], p.x + 200, p.y, 0, p.sector); g.mobjs.push(m); } g.player.teleportTo(g, m.x, m.y, 0); g.player.reaction = 0; g.tick(NO); };

// 피해: 1단계는 절반
for (const [skill, expect] of [[1, 10], [3, 20], [4, 20], [5, 20]]) { const g = mk(skill); g.player.health = 100; g.player.damage(20, g); ok(`난이도 ${skill}: 피해 20 → ${expect}`, 100 - g.player.health === expect, `(${100 - g.player.health})`); }
// 탄약: 1·5단계는 2배
for (const [skill, expect] of [[1, 20], [2, 10], [3, 10], [5, 20]]) { const g = mk(skill); g.player.ammo.clip = 0; pick(g, 2007); ok(`난이도 ${skill}: 탄창 → 탄약 +${expect}`, g.player.ammo.clip === expect, `(${g.player.ammo.clip})`); }
// 배치: 난이도별 몬스터 수 (쉬움 ≤ 보통 ≤ 어려움)
const counts = [1, 3, 4].map((s) => mk(s, 'E1M3').killsTotal);
ok('몬스터 수: 쉬움 ≤ 보통 ≤ 어려움', counts[0] <= counts[1] && counts[1] <= counts[2] && counts[0] < counts[2], `(${counts.join(' ≤ ')})`);
// 악몽: 상태 시간이 절반
{ const g3 = mk(3), g5 = mk(5); const a = g3.mobjs.find((m) => m.type === 3004), c = g5.mobjs.find((m) => m.type === 3004);
  a.setState('attack', g3); c.setState('attack', g5);
  ok('악몽: 공격 상태 tic 이 절반', c.tics === a.tics >> 1 && a.tics === 10, `(보통 ${a.tics}, 악몽 ${c.tics})`); }
console.log(out.join('\n'));

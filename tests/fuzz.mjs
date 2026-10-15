import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (const m of wad.getMapNames()) {
  const lvl = loadLevel(wad, m); const g = new Game(lvl); const p = g.player;
  let stuckBlocked = 0, nan = 0, exits = 0, teleports = 0, maxThinkers = 0, minHp = 100, err = null;
  const solidAt = (x, y) => g.physics.things.some((o) => Math.abs(o.x - x) < o.radius + 16 && Math.abs(o.y - y) < o.radius + 16);
  const spawnTh = lvl.things.filter((t) => !solidAt(t.x, t.y)).slice(0, 80);
  try {
    for (let run = 0; run < 12; run++) {
      const t = spawnTh[(rnd() * spawnTh.length) | 0] ?? { x: p.x, y: p.y };
      p.teleportTo(g, t.x, t.y, rnd() * 6.28); p.reaction = 0; p.health = 100; p.dead = false; g.exited = null;
      let ang = rnd() * 6.28;
      for (let tic = 0; tic < 700; tic++) {
        if (tic % 40 === 0) ang += (rnd() - 0.5) * 3;
        g.tick({ forward: rnd() < 0.9 ? 50 : 0, side: rnd() < 0.2 ? (rnd() < 0.5 ? 40 : -40) : 0, turn: (ang - p.angle) * 0.2, use: rnd() < 0.15 });
        if (g.exited) { exits++; g.exited = null; }
        if (!Number.isFinite(p.x + p.y + p.z + p.viewz)) nan++;
        const r = g.physics.check(p.x, p.y, p.z);
        if (r.blocked && r.ceilz - r.floorz >= 56) stuckBlocked++;   // 문/리프트 때문에 낀 게 아니라 벽에 박힌 경우
        maxThinkers = Math.max(maxThinkers, g.thinkers.length);
        minHp = Math.min(minHp, p.health); if (p.health < 30) p.health = 100;
      }
    }
  } catch (e) { err = e.stack.split('\n').slice(0, 3).join(' | '); }
  for (const s of lvl.sectors) if (!Number.isFinite(s.floorHeight + s.ceilingHeight + s.light) || s.ceilingHeight < s.floorHeight - 1) nan++;
  console.log(m.padEnd(5), err ? `ERROR ${err}` : `ok  wallStuck=${stuckBlocked} nan/badSector=${nan} exits=${exits} thinkers≤${maxThinkers} minHp=${minHp} secrets=${g.secretsFound}/${g.secretsTotal}`);
}

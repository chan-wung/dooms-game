import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { Renderer } from '../src/render/renderer.js';
import { TextureStore } from '../src/gfx/textures.js';
import { SpriteStore } from '../src/gfx/sprites.js';
import { loadPalette } from '../src/gfx/palette.js';
import { sectorAt } from '../src/render/bsp.js';
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const gfx = { palette: loadPalette(wad), textures: new TextureStore(wad), sprites: new SpriteStore(wad) };
const r = new Renderer(gfx);
const SENT = 0x01020304;
r.pixels.fill = () => Uint32Array.prototype.fill.call(r.pixels, SENT);
let maxMs = 0, total = 0, frames = 0;
for (const m of wad.getMapNames()) {
  const lvl = loadLevel(wad, m); const g = new Game(lvl, 3);
  let holes = 0, withSprites = 0, n = 0, sprTotal = 0;
  const pts = lvl.things.slice(0, 150);
  for (const t of pts) for (const a of [0, 1.57, 3.14, 4.71]) {
    const sec = sectorAt(lvl, t.x, t.y);
    const t0 = performance.now();
    r.render(lvl, { x: t.x, y: t.y, angle: a, z: sec.floorHeight + 41 }, g.mobjs);
    const ms = performance.now() - t0; maxMs = Math.max(maxMs, ms); total += ms; frames++;
    let z = 0; const p = r.pixels; for (let i = 0; i < 320 * 168; i++) if (p[i] === SENT) z++;
    n++; if (z > 0) holes++;
    if (r.spritesDrawn > 0) withSprites++; sprTotal += r.spritesDrawn;
  }
  console.log(m.padEnd(5), `frames ${n}  스프라이트가 그려진 프레임 ${withSprites}  평균 스프라이트/프레임 ${(sprTotal / n).toFixed(1)}  구멍 프레임 ${holes}`);
}
console.log(`평균 ${(total / frames).toFixed(2)}ms, 최대 ${maxMs.toFixed(2)}ms / 프레임 (${frames} 프레임)`);

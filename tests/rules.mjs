import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { killMobj } from '../src/game/combat.js';
import { saveGame, loadGame } from '../src/game/savegame.js';
import { loadPalette, tintPalette } from '../src/gfx/palette.js';

const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false, weapon: 0, cycle: 0 };
const tick = (g, n) => { for (let i = 0; i < n; i++) g.tick(NO); };

// ---------- 도넛 (E1M2 선 9) ----------
{
  const g = new Game(loadLevel(wad, 'E1M2'), 3, 1);
  const ld = g.level.linedefs.find((l) => l.special === 9);
  ok('E1M2 에 도넛 선 존재', !!ld);
  const [s1] = g.specials.sectorsWithTag(ld.tag);
  g.specials.activate(ld, 0, 'use');
  const movers = g.thinkers.filter((t) => t.sector);
  ok('도넛: 기둥과 링 두 곳이 움직이기 시작', movers.length === 2, `(${movers.length})`);
  const ring = movers.find((t) => t.direction === 1).sector, pillar = movers.find((t) => t.direction === -1).sector;
  ok('도넛: 기둥은 내려가고 링은 올라감', pillar === s1);
  // 도중에 저장 → 불러오기해도 끝까지 이어진다
  tick(g, 20);
  const mid = loadGame(loadLevel(wad, 'E1M2'), 3, JSON.parse(JSON.stringify(saveGame(g))));
  for (const game of [g, mid]) tick(game, 900);
  for (const [name, game] of [['원본', g], ['불러온 것', mid]]) {
    const p = game.level.sectors[pillar.index], r = game.level.sectors[ring.index];
    const outer = r.lines.map((l) => (l.frontSector === r ? l.backSector : l.frontSector)).filter((o) => o && o !== p && o !== r);
    ok(`도넛(${name}): 링과 기둥이 같은 높이에 멈춤`, p.floorHeight === r.floorHeight && outer.every((o) => o.floorHeight === p.floorHeight),
      `(기둥 ${p.floorHeight}, 링 ${r.floorHeight}, 바깥 ${outer.map((o) => o.floorHeight)})`);
    ok(`도넛(${name}): 링 바닥 무늬가 바깥 것으로`, outer.some((o) => o.floorTex === r.floorTex), `(${r.floorTex})`);
    ok(`도넛(${name}): 끝나면 thinker 정리`, !r.specialData && !p.specialData);
  }
}

// ---------- 악몽 난이도 부활 ----------
for (const [skill, expectRespawn] of [[5, true], [3, false]]) {
  const g = new Game(loadLevel(wad, 'E1M1'), skill, 4);
  const z = g.mobjs.find((m) => m.type === 3004);
  const [sx, sy] = [z.x, z.y];
  g.player.health = 10000; g.player.powers.invuln = 1e9;        // 놔두고 지켜보기만 한다
  g.player.teleportTo(g, g.level.playerStart.x, g.level.playerStart.y, 0);
  killMobj(g, g.player, z);
  tick(g, 60);
  ok(`skill ${skill}: 쓰러진 시체`, z.corpse && z.tics === -1);
  tick(g, 12 * 35 - 80);
  ok(`skill ${skill}: 12초 전에는 부활 안 함`, !g.mobjs.some((m) => m !== z && m.type === 3004 && m.x === sx && m.y === sy && m.health > 0));
  tick(g, 8000);
  const reborn = g.mobjs.find((m) => m !== z && m.type === 3004 && m.spawnX === sx && m.spawnY === sy && m.health > 0);
  ok(`skill ${skill}: 시간이 지나면 ${expectRespawn ? '부활' : '그대로 시체'}`, expectRespawn ? !!reborn && z.removed : !reborn && !z.removed);
}

// ---------- 화면 색조 (원작 팔레트 번호) ----------
{
  const g = new Game(loadLevel(wad, 'E1M1'), 3, 1), p = g.player;
  ok('색조: 평소에는 기본 팔레트', tintPalette(p) === 0);
  p.damage(30, g); ok('색조: 맞으면 빨강(1~8)', tintPalette(p) >= 1 && tintPalette(p) <= 8, `(${tintPalette(p)})`);
  p.damageCount = 100; ok('색조: 크게 맞으면 가장 진한 빨강(8)', tintPalette(p) === 8);
  p.damageCount = 0; p.bonusCount = 6; ok('색조: 아이템을 주우면 금색(9~12)', tintPalette(p) >= 9 && tintPalette(p) <= 12, `(${tintPalette(p)})`);
  p.bonusCount = 0; p.powers.radsuit = 500; ok('색조: 방사능복은 초록(13)', tintPalette(p) === 13);
  p.powers.radsuit = 0; p.powers.berserk = 1; ok('색조: 버서크 직후 빨강', tintPalette(p) >= 1);
  p.powers.berserk = 12 * 64; ok('색조: 버서크 시간이 지나면 풀림', tintPalette(p) === 0);
  // 아이템을 실제로 줍는 경로: bonusCount 가 쌓였다가 줄어든다
  p.powers.berserk = 0; p.health = 50;
  const item = g.mobjs.find((m) => m.pickup === 'healthBonus' || m.pickup === 'armorBonus');
  if (item) { p.teleportTo(g, item.x, item.y, 0); p.reaction = 0; g.tick(NO); ok('줍기: bonusCount 증가', p.bonusCount > 0, `(${p.bonusCount})`); tick(g, 10); ok('줍기: 시간이 지나면 줄어듦', p.bonusCount === 0); }
  const pal = loadPalette(wad);
  ok('팔레트: 색조 팔레트는 기본과 다름', pal.litFor(1)[0][4] !== pal.lit[0][4] && pal.litFor(13) !== pal.lit);
}

console.log(out.join('\n'));

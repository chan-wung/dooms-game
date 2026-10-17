/**
 * 둠2(DOOM2.WAD) 전용: MAP01~32, 진행·이야기 화면, 슈퍼 샷건·메가스피어, 둠2 몬스터, MAP07·MAP30·MAP32 보스, 크러셔.
 * public/wad/DOOM2.WAD 가 없으면 건너뛴다.
 */
import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { Mobj } from '../src/game/mobj.js';
import { THING_INFO } from '../src/game/info.js';
import { checkSight, damageMobj } from '../src/game/combat.js';
import { giveKfa } from '../src/game/cheats.js';
import { requestWeapon } from '../src/game/weapons.js';
import { touchSpecial } from '../src/game/items.js';
import { saveGame, loadGame as restore } from '../src/game/savegame.js';
import { nextMapName, storyAfter, mapSong } from '../src/app/progress.js';
import { parTime } from '../src/ui/intermission.js';
import { sectorAt } from '../src/render/bsp.js';

const path = new URL('../public/wad/DOOM2.WAD', import.meta.url);
if (!fs.existsSync(path)) { console.log('SKIP  public/wad/DOOM2.WAD 없음'); process.exit(0); }
const b = fs.readFileSync(path);
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false };
const tick = (g, n, cmd = NO) => { for (let i = 0; i < n; i++) g.tick(cmd); };
const newGame = (map, seed = 7, skill = 3) => { const g = new Game(loadLevel(wad, map), skill, seed); g.registered = g.commercial = true; return g; };
const find = (g, type) => g.mobjs.find((m) => m.type === type && !m.removed);
const mapWith = (type) => wad.getMapNames().find((n) => loadLevel(wad, n).things.some((t) => t.type === type && (t.flags & 2)));

/** mon 이 보이는 자리에 플레이어를 세운다 */
const placeFacing = (g, mon, dists = [200, 150, 260, 120, 320, 400]) => {
  for (const d of dists) for (let a = 0; a < 48; a++) {
    const ang = (a * Math.PI) / 24, x = mon.x + Math.cos(ang) * d, y = mon.y + Math.sin(ang) * d;
    const s = sectorAt(g.level, x, y);
    if (g.physics.check(x, y, s.floorHeight).blocked) continue;
    if (!checkSight(g, { x, y, z: s.floorHeight, height: 56 }, mon)) continue;
    g.player.teleportTo(g, x, y, Math.atan2(mon.y - y, mon.x - x)); g.player.reaction = 0;
    return true;
  }
  return false;
};
/** type 몬스터 하나만 남기고, 플레이어 앞에 세워 깨운다 (맵을 돌며 설 자리가 있는 것을 찾는다) */
const duel = (type, seed = 7, dists = undefined) => {
  for (const map of wad.getMapNames()) {
    if (!loadLevel(wad, map).things.some((t) => t.type === type && (t.flags & 2))) continue;
    const g = newGame(map, seed);
    const m = g.mobjs.find((o) => o.type === type && placeFacing(g, o, dists));
    if (!m) continue;
    for (const o of g.mobjs) if (o !== m && o.info.monster) g.removeMobj(o);
    tick(g, 1);
    g.player.health = 100000; m.target = g.player; m.reaction = 0; m.setState('run', g);
    return { g, m, p: g.player };
  }
  return null;
};
/** 몬스터가 플레이어에게 피해를 줄 때까지 (최대 n tic) — 그동안 생긴 물체 종류도 모은다 */
const fight = (d, missile, n = 2000) => {
  const hp = d.p.health, kinds = new Set();
  for (let i = 0; i < n && (d.p.health === hp || (missile && !kinds.has(missile))); i++) { d.g.tick(NO); for (const o of d.g.mobjs) kinds.add(o.type); }
  return { hurt: d.p.health < hp, kinds };
};

// ---------- 1. 모든 맵 ----------
{
  const maps = wad.getMapNames();
  ok('MAP01~32', maps.length === 32 && maps[0] === 'MAP01', `(${maps.length})`);
  const unknown = {};
  for (const n of maps) for (const [t, c] of newGame(n).unknownThings) unknown[t] = (unknown[t] ?? 0) + c;
  ok('모든 맵의 thing 종류를 안다', !Object.keys(unknown).length, JSON.stringify(unknown));
}

// ---------- 2. 진행 · 이야기 화면 · 음악 · 기준 시간 ----------
ok('MAP01 → MAP02', nextMapName('MAP01', false) === 'MAP02');
ok('MAP15 비밀 출구 → MAP31', nextMapName('MAP15', true) === 'MAP31');
ok('MAP31 비밀 출구 → MAP32, 일반 → MAP16', nextMapName('MAP31', true) === 'MAP32' && nextMapName('MAP31', false) === 'MAP16');
ok('MAP32 → MAP16', nextMapName('MAP32', false) === 'MAP16');
ok('MAP30 이 마지막', nextMapName('MAP30', false) === null);
ok('이야기 화면: 6·11·20·30, 비밀 15·31', storyAfter('MAP06') === 'C1' && storyAfter('MAP11') === 'C2' && storyAfter('MAP20') === 'C3'
  && storyAfter('MAP30') === 'C4' && storyAfter('MAP15', true) === 'C5' && storyAfter('MAP31', true) === 'C6' && storyAfter('MAP15', false) === null);
ok('맵 음악 MAP01 = D_RUNNIN, MAP30 = D_OPENIN', mapSong('MAP01') === 'D_RUNNIN' && mapSong('MAP30') === 'D_OPENIN' && wad.has(mapSong('MAP17')));
ok('기준 시간 MAP01 = 30, MAP17 = 420', parTime('MAP01') === 30 && parTime('MAP17') === 420);

// ---------- 3. 슈퍼 샷건 · 메가스피어 · 치트 ----------
{
  const g = newGame('MAP01'); const p = g.player;
  giveKfa(g);
  ok('IDKFA → 슈퍼 샷건까지', p.weapons.has('superShotgun') && p.weapons.has('bfg'));
  tick(g, 40);
  requestWeapon(p, 3); tick(g, 40);
  ok('3번 → 슈퍼 샷건', p.readyWeapon === 'superShotgun', `(${p.readyWeapon})`);
  requestWeapon(p, 3); tick(g, 40);
  ok('한 번 더 3번 → 일반 샷건', p.readyWeapon === 'shotgun', `(${p.readyWeapon})`);
  const mega = new Mobj(83, THING_INFO[83], p.x, p.y, 0, p.sector);
  p.health = 50; p.armor = 0;
  touchSpecial(g, p, mega);
  ok('메가스피어: 체력 200 · 방어구 200', p.health === 200 && p.armor === 200 && p.armorType === 2);
}
{
  const d = duel(3004);
  const { g, p, m } = d;
  p.weapons.add('superShotgun'); p.ammo.shell = 20; p.pendingWeapon = 'superShotgun';
  m.setState('stand', g); m.target = null;
  tick(g, 60);
  tick(g, 2, { ...NO, fire: true }); tick(g, 60);
  ok('슈퍼 샷건 한 발 = 탄약 2', p.ammo.shell === 18, `(${p.ammo.shell})`);
  ok('슈퍼 샷건으로 좀비맨 처치', m.health <= 0, `(hp ${m.health})`);
}

// ---------- 4. 둠2 몬스터가 각자 방식으로 공격한다 ----------
for (const [type, name, missile] of [[65, '체인거너', null], [84, 'SS', null], [69, '헬 나이트', 'bruiserShot'], [66, '레버넌트', 'tracer'],
  [67, '맨큐버스', 'fatShot'], [68, '아라크노트론', 'arachPlaz'], [64, '아크바일', 'vileFire']]) {
  const d = duel(type, 7, type === 66 ? [450, 400, 500, 350] : undefined);   // 레버넌트는 가까우면 주먹만 쓴다
  if (!d) { ok(`${name} 시험 위치`, false); continue; }
  const r = fight(d, missile);
  ok(`${name}: 플레이어에게 피해`, r.hurt);
  if (missile) ok(`${name}: ${missile} 발사`, r.kinds.has(missile));
}
{
  const d = duel(71);
  let skulls = 0;
  for (let i = 0; i < 1500 && !skulls; i++) { d.g.tick(NO); skulls = d.g.mobjs.filter((o) => o.type === 3006).length; }
  ok('페인 엘리멘탈: 로스트 소울을 뱉는다', skulls > 0);
  const before = new Set(d.g.mobjs.filter((o) => o.type === 3006));
  damageMobj(d.g, d.m, d.p, d.p, 10000);
  const born = new Set();
  for (let i = 0; i < 80; i++) { d.g.tick(NO); for (const o of d.g.mobjs) if (o.type === 3006 && !before.has(o)) born.add(o); }
  ok('페인 엘리멘탈이 죽을 때 로스트 소울을 뱉는다', born.size >= 1, `(${born.size})`);
}
{ // 아크바일: 시체를 되살린다
  const d = duel(64);
  const { g, m } = d;
  const imp = new Mobj(3001, THING_INFO[3001], m.x + 40, m.y, 0, sectorAt(g.level, m.x + 40, m.y));
  g.addMobj(imp);
  damageMobj(g, imp, d.p, d.p, 1000); tick(g, 60);
  ok('되살릴 시체 준비', imp.corpse && imp.tics === -1);
  let raised = false;
  for (let i = 0; i < 2000 && !raised; i++) {
    m.moveDir = Math.round(Math.atan2(imp.y - m.y, imp.x - m.x) / (Math.PI / 4) + 8) % 8;
    g.tick(NO); raised = !imp.corpse;
  }
  ok('아크바일이 임프를 되살림', raised && imp.health === 60);
}

// ---------- 5. 보스 ----------
{
  const g = newGame('MAP07');
  const f666 = g.level.sectors.filter((s) => s.tag === 666), f667 = g.level.sectors.filter((s) => s.tag === 667);
  const h666 = f666.map((s) => s.floorHeight), h667 = f667.map((s) => s.floorHeight);
  for (const m of g.mobjs.filter((o) => o.type === 67)) damageMobj(g, m, g.player, g.player, 100000);
  tick(g, 400);
  ok('MAP07 맨큐버스 전멸 → 태그 666 바닥 내려감', f666.some((s, i) => s.floorHeight < h666[i]));
  for (const m of g.mobjs.filter((o) => o.type === 68)) damageMobj(g, m, g.player, g.player, 100000);
  tick(g, 600);
  ok('MAP07 아라크노트론 전멸 → 태그 667 바닥 올라감', f667.some((s, i) => s.floorHeight > h667[i]));
}
{
  const g = newGame('MAP32');
  const doors = g.level.sectors.filter((s) => s.tag === 666), h0 = doors.map((s) => s.ceilingHeight);
  for (const m of g.mobjs.filter((o) => o.type === 72)) damageMobj(g, m, g.player, g.player, 100000);
  tick(g, 300);
  ok('MAP32 커맨더 킨 전멸 → 태그 666 문 열림', doors.some((s, i) => s.ceilingHeight > h0[i]));
}
{
  const g = newGame('MAP30', 7, 4);
  const eye = find(g, 89), brain = find(g, 88);
  ok('MAP30 아이콘 오브 신 (뇌·눈)', !!eye && !!brain && eye.hidden);
  eye.target = g.player; eye.setState('run', g);
  const before = g.mobjs.filter((o) => o.info.monster).length;
  let cube = false;
  for (let i = 0; i < 1200; i++) { g.tick(NO); if (g.mobjs.some((o) => o.type === 'spawnCube')) cube = true; }
  ok('눈이 큐브를 쏜다', cube);
  ok('큐브가 몬스터를 부른다', g.mobjs.filter((o) => o.info.monster).length > before);
  g.player.god = true;
  damageMobj(g, brain, g.player, g.player, 10000);
  tick(g, 200);
  ok('뇌가 죽으면 게임 끝 (맵 끝)', !!g.exited);
}

// ---------- 6. 크러셔 ----------
{
  const map = wad.getMapNames().find((n) => loadLevel(wad, n).linedefs.some((l) => l.special === 73 || l.special === 77 || l.special === 25));
  const g = newGame(map);
  const ld = g.level.linedefs.find((l) => [73, 77, 25].includes(l.special));
  const sec = g.specials.sectorsWithTag(ld.tag)[0];
  const ceil0 = sec.ceilingHeight;
  g.specials.activate(ld, 0, 'walk');
  tick(g, 60);
  ok(`${map} 크러셔가 내려온다`, sec.ceilingHeight < ceil0, `(${ceil0} → ${sec.ceilingHeight})`);
  // 크러셔 밑에 선 플레이어는 피해를 입는다
  const p = g.player, x = (sec.lines[0].v1.x + sec.lines[0].v2.x) / 2, y = (sec.lines[0].v1.y + sec.lines[0].v2.y) / 2;
  let spot = null;
  for (let r = 4; r < 200 && !spot; r += 4) for (let a = 0; a < 16 && !spot; a++) {
    const sx = x + r * Math.cos((a * Math.PI) / 8), sy = y + r * Math.sin((a * Math.PI) / 8);
    if (sectorAt(g.level, sx, sy) === sec && !g.physics.check(sx, sy, sec.floorHeight).blocked) spot = [sx, sy];
  }
  if (spot) {
    p.teleportTo(g, spot[0], spot[1], 0); p.health = 1000;
    tick(g, 400);
    ok('크러셔에 끼면 피해', p.health < 1000, `(${p.health})`);
  } else ok('크러셔 아래 설 자리', false);
  // 저장/불러오기에 크러셔가 남는다
  const back = restore(g.level, 3, JSON.parse(JSON.stringify(saveGame(g))));
  ok('저장해도 크러셔 유지', back.thinkers.some((t) => t.constructor.name === 'Ceiling'));
}

for (const l of out) console.log(l);

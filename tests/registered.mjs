/**
 * 정식판(DOOM.WAD) 전용 기능: 에피소드 2~4 맵, 플라즈마·BFG, 카코데몬·로스트 소울·사이버데몬·스파이더, 보스 맵, 치트 무기.
 * public/wad/DOOM.WAD 가 없으면 건너뛴다.
 */
import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { checkSight, damageMobj, radiusAttack } from '../src/game/combat.js';
import { giveKfa } from '../src/game/cheats.js';
import { saveGame, loadGame as restore } from '../src/game/savegame.js';
import { nextMapName } from '../src/app/progress.js';
import { parTime } from '../src/ui/intermission.js';
import { sectorAt } from '../src/render/bsp.js';

const path = new URL('../public/wad/DOOM.WAD', import.meta.url);
if (!fs.existsSync(path)) { console.log('SKIP  public/wad/DOOM.WAD 없음'); process.exit(0); }
const b = fs.readFileSync(path);
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false };
const tick = (g, n, cmd = NO) => { for (let i = 0; i < n; i++) g.tick(cmd); };
const newGame = (map, seed = 7) => { const g = new Game(loadLevel(wad, map), 3, seed); g.registered = true; return g; };
const find = (g, type) => g.mobjs.find((m) => m.type === type && !m.removed);
const mapWith = (type) => wad.getMapNames().find((n) => /^E[2-4]/.test(n) && loadLevel(wad, n).things.some((t) => t.type === type && (t.flags & 2)));

/** mon 이 보이는 위치에 플레이어를 세운다 */
const placeFacing = (g, mon, dists = [200, 150, 260, 120, 320, 400]) => {
  const p = g.player;
  for (const d of dists) for (let a = 0; a < 48; a++) {
    const ang = (a * Math.PI) / 24, x = mon.x + Math.cos(ang) * d, y = mon.y + Math.sin(ang) * d;
    const s = sectorAt(g.level, x, y);
    if (g.physics.check(x, y, s.floorHeight).blocked) continue;
    if (!checkSight(g, { x, y, z: s.floorHeight, height: 56 }, mon)) continue;
    p.teleportTo(g, x, y, Math.atan2(mon.y - y, mon.x - x)); p.reaction = 0;
    return true;
  }
  return false;
};

// ---------- 1. 모든 정식판 맵이 열리고, 모르는 thing 이 없다 ----------
{
  const maps = wad.getMapNames().filter((n) => /^E[2-4]/.test(n));
  ok('에피소드 2~4 맵 27개', maps.length === 27, `(${maps.length})`);
  const unknown = {};
  for (const n of maps) for (const [t, c] of newGame(n).unknownThings) unknown[t] = (unknown[t] ?? 0) + c;
  ok('모든 맵의 thing 종류를 안다', !Object.keys(unknown).length, JSON.stringify(unknown));
}

// ---------- 2. 치트: 정식판이면 플라즈마·BFG 까지 ----------
{
  const g = newGame('E2M1');
  giveKfa(g);
  ok('IDKFA → 플라즈마·BFG', g.player.weapons.has('plasmaGun') && g.player.weapons.has('bfg'));
  const s = newGame('E2M1'); s.registered = false;
  giveKfa(s);
  ok('셰어웨어 IDKFA 는 플라즈마·BFG 없음', !s.player.weapons.has('plasmaGun') && !s.player.weapons.has('bfg'));
}

// ---------- 3. 카코데몬: 떠다니고, 플라즈마로 잡으면 바닥으로 떨어진다 ----------
{
  const map = mapWith(3005);
  const g = newGame(map); const p = g.player; const c = find(g, 3005);
  ok(`${map} 에 카코데몬`, !!c && c.floating);
  ok('카코데몬이 보이는 위치 확보', placeFacing(g, c));
  p.health = 1000; p.god = true; p.weapons.add('plasmaGun'); p.ammo.cell = 300; p.pendingWeapon = 'plasmaGun';
  tick(g, 40);
  ok('플라즈마건 들기', p.readyWeapon === 'plasmaGun', `(${p.readyWeapon})`);
  const cells = p.ammo.cell;
  tick(g, 700, { ...NO, fire: true });
  ok('플라즈마 탄약 소모', p.ammo.cell < cells, `(${cells} → ${p.ammo.cell})`);
  ok('플라즈마로 카코데몬 사망', c.health <= 0, `(hp ${c.health})`);
  tick(g, 200);
  ok('죽은 카코데몬은 바닥에 떨어짐', Math.abs(c.z - c.floorz) < 1, `(z ${c.z} floor ${c.floorz})`);
}

// ---------- 4. BFG: 한 발에 40 셀, 공이 터지면 주변을 쓸어버린다 ----------
{
  const map = mapWith(3005);
  const g = newGame(map); const p = g.player; const c = find(g, 3005);
  placeFacing(g, c);
  p.god = true; p.weapons.add('bfg'); p.ammo.cell = 80; p.pendingWeapon = 'bfg';
  tick(g, 80);                                       // 권총을 내리고 BFG 를 올릴 때까지
  tick(g, 2, { ...NO, fire: true }); tick(g, 120);
  ok('BFG 한 발 = 셀 40', p.ammo.cell === 40, `(${p.ammo.cell})`);
  ok('BFG 로 카코데몬에 큰 피해', c.health < 400, `(hp ${c.health})`);
  p.ammo.cell = 39;
  tick(g, 60, { ...NO, fire: true });
  ok('셀 40 미만이면 다른 무기로', p.readyWeapon !== 'bfg' || p.pendingWeapon !== null, `(${p.readyWeapon})`);
}

// ---------- 5. 로스트 소울: 돌진해서 들이받는다 (킬 수에는 안 들어감) ----------
{
  // 앞에 설 자리가 있는 로스트 소울을 맵을 돌며 찾는다
  let g, s;
  for (const map of wad.getMapNames().filter((n) => /^E[2-4]/.test(n))) {
    g = newGame(map, 3);
    s = g.mobjs.find((m) => m.type === 3006 && placeFacing(g, m, [150, 120, 200, 100]));
    if (s) break;
  }
  ok('로스트 소울이 보이는 위치 확보', !!s, `(${g.level.name})`);
  const p = g.player;
  ok('킬 수 합계에서 빠짐', g.killsTotal === g.mobjs.filter((m) => m.info.monster && m.type !== 3006).length);
  for (const o of g.mobjs) if (o !== s && o.info.monster) g.removeMobj(o);   // 다른 몬스터가 끼어들지 않게
  tick(g, 1);
  p.health = 1000;
  s.target = p; s.setState('run', g);               // 등을 돌리고 있을 수 있으니 바로 깨운다
  const hp0 = p.health;
  let charged = false;
  for (let i = 0; i < 600 && p.health === hp0; i++) { g.tick(NO); if (s.skullFly) charged = true; }
  ok('로스트 소울 돌진', charged);
  ok('들이받아 피해', p.health < hp0, `(${hp0} → ${p.health})`);
  // 돌진 중 저장/불러오기
  s.skullFly = true; s.momx = 5;
  const back = restore(g.level, 3, JSON.parse(JSON.stringify(saveGame(g))));
  const s2 = back.mobjs.find((m) => m.type === 3006);
  ok('저장해도 돌진 상태 유지', s2.skullFly && s2.floating);
}

// ---------- 6. 사이버데몬·스파이더는 폭발 피해를 받지 않는다 ----------
{
  const g = newGame('E2M8'); const cy = find(g, 16);
  ok('E2M8 에 사이버데몬', !!cy);
  const hp = cy.health;
  radiusAttack(g, { x: cy.x, y: cy.y, z: cy.z, sector: cy.sector }, g.player, 128);
  ok('사이버데몬 폭발 면역', cy.health === hp);
}

// ---------- 7. 보스 맵: 보스가 죽으면 끝/문/바닥 ----------
const killBoss = (g, type) => {
  for (const m of g.mobjs.filter((o) => o.type === type)) damageMobj(g, m, g.player, g.player, 100000);
  tick(g, 300);
};
{
  const g = newGame('E2M8'); killBoss(g, 16);
  ok('E2M8 사이버데몬 사망 → 맵 끝', !!g.exited);
}
{
  const g = newGame('E3M8'); killBoss(g, 7);
  ok('E3M8 스파이더 사망 → 맵 끝', !!g.exited);
}
{
  const g = newGame('E4M6');
  const doors = g.level.sectors.filter((s) => s.tag === 666), h0 = doors.map((s) => s.ceilingHeight);
  killBoss(g, 16);
  ok('E4M6 사이버데몬 사망 → 태그 666 문 열림', doors.length > 0 && doors.some((s, i) => s.ceilingHeight > h0[i]));
}
{
  const g = newGame('E4M8');
  const floors = g.level.sectors.filter((s) => s.tag === 666), h0 = floors.map((s) => s.floorHeight);
  killBoss(g, 7);
  ok('E4M8 스파이더 사망 → 태그 666 바닥 내려감', floors.length > 0 && floors.some((s, i) => s.floorHeight < h0[i]));
}

// ---------- 8. 진행 순서 · 기준 시간 ----------
ok('E4M9 → E4M3', nextMapName('E4M9', false) === 'E4M3');
ok('E2M8 은 에피소드 끝', nextMapName('E2M8', false) === null);
ok('기준 시간 E2M6 = 360, E3M2 = 45, E4 없음', parTime('E2M6') === 360 && parTime('E3M2') === 45 && parTime('E4M1') === 0);

for (const l of out) console.log(l);

import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { SpriteStore } from '../src/gfx/sprites.js';
import { Mobj } from '../src/game/mobj.js';
import { THING_INFO } from '../src/game/info.js';
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const ss = new SpriteStore(wad);

// 1. 표의 모든 스프라이트 프레임이 WAD 에 있고 디코딩된다
let missing = [];
const used = new Set();
for (const m of wad.getMapNames()) for (const t of loadLevel(wad, m).things) used.add(String(t.type));
for (const [type, info] of Object.entries(THING_INFO)) {
  if (!used.has(type)) continue;
  for (const ch of new Set(info.seq)) {
    const f = ss.frame(info.sprite, ch.charCodeAt(0) - 65);
    if (!f) { missing.push(`${type}:${info.sprite}${ch}`); continue; }
    for (const r of f.rot) { try { ss.tex(r.lump); } catch (e) { missing.push(`${type}:decode ${info.sprite}${ch}`); } }
  }
}
ok('9개 맵에 실제 배치된 모든 종류의 스프라이트 프레임 존재/디코딩', missing.length === 0, missing.join(' '));

// 2. 9개 맵: 표에 없는 thing 종류
const unk = {}; const per = [];
for (const m of wad.getMapNames()) {
  const g = new Game(loadLevel(wad, m), 3);
  for (const [t, n] of g.unknownThings) unk[t] = (unk[t] || 0) + n;
  per.push(`${m}:${g.mobjs.length}(킬${g.killsTotal}/아이템${g.itemsTotal})`);
}
ok('모르는 thing 종류 없음', Object.keys(unk).length === 0, JSON.stringify(unk));
console.log(per.join('  '));

// 3. 회전 규칙: TROO 정면 프레임은 A1, 뒷면 A5, 측면은 반전 쌍 (A2A8, A3A7, A4A6)
{
  const f = ss.frame('TROO', 0);
  const names = f.rot.map((r) => wad.lumps[r.lump].name + (r.flip ? '(flip)' : ''));
  ok('TROO A 회전 8방향 (A1 A2A8 A3A7 A4A6 A5 …)', names[0].startsWith('TROOA1') && names[4].startsWith('TROOA5') && f.rot[7].flip && !f.rot[1].flip && f.rot[1].lump === f.rot[7].lump, names.join(' '));
}

// 4. 아이템 획득 효과
const fresh = () => { const g = new Game(loadLevel(wad, 'E1M1'), 3); return g; };
const give = (g, type, mut) => { let m = g.mobjs.find((o) => o.type === type); if (!m) { const st = g.player; m = new Mobj(type, THING_INFO[type], st.x + 200, st.y, 0, st.sector); g.mobjs.push(m); } const p = g.player; if (mut) mut(p); p.teleportTo(g, m.x, m.y, 0); p.reaction = 0; g.tick({ forward: 0, side: 0, turn: 0, use: false }); return m; };
{ const g = fresh(); const m = give(g, 2011, (p) => { p.health = 50; });
  ok('스팀팩 +10', m && g.player.health === 60 && m.removed, `(hp ${g.player.health})`); }
{ const g = fresh(); const m = give(g, 2011, (p) => { p.health = 100; });
  ok('체력 100이면 스팀팩은 남음', m && g.player.health === 100 && !m.removed); }
{ const g = fresh(); const m = give(g, 2012, (p) => { p.health = 10; });
  ok('메디킷 +25 (급할 때 메시지)', m && g.player.health === 35 && /REALLY/.test(g.message), `(${g.message})`); }
{ const g = fresh(); const m = give(g, 2014, null);
  ok('체력 보너스 +1 (최대 200), 아이템 수 증가', m && g.player.health === 101 && g.itemsFound === 1, `(hp ${g.player.health}, items ${g.itemsFound})`); }
{ const g = fresh(); const m = give(g, 2018, null);
  ok('초록 방어구: 100, 종류 1', m && g.player.armor === 100 && g.player.armorType === 1); 
  g.player.damage(30, g); ok('방어구가 1/3 흡수 (30 → 20 피해, 방어구 -10)', g.player.health === 80 && g.player.armor === 90, `(hp ${g.player.health}, armor ${g.player.armor})`); }
{ const g = fresh(); const m = give(g, 2007, (p) => { p.ammo.clip = 20; });
  ok('탄창 +10', m && g.player.ammo.clip === 30); }
{ const g = fresh(); const m = give(g, 2007, (p) => { p.ammo.clip = 200; });
  ok('총알 200이면 탄창은 남음', m && g.player.ammo.clip === 200 && !m.removed); }
{ const g = fresh(); const m = give(g, 2001, null);
  ok('샷건: 무기 획득 + 셸 8', m && g.player.weapons.has('shotgun') && g.player.ammo.shell === 8 && g.player.pendingWeapon === 'shotgun', `(shell ${g.player.ammo.shell})`); }
{ const g = fresh(); const m = give(g, 8, null);
  ok('배낭: 최대 탄약 2배 + 탄약 1묶음', m && g.player.maxAmmo.clip === 400 && g.player.ammo.clip === 60 && g.player.ammo.shell === 4, JSON.stringify(g.player.ammo)); }
{ const g = fresh(); const m = give(g, 2013, null);
  ok('소울스피어 +100 (최대 200)', m && g.player.health === 200); }
{ const g = fresh(); const m = give(g, 2025, null); const p = g.player;
  ok('방사능복 파워업', m && p.powers.radsuit === 35 * 60 - 1 + 0 || p.powers.radsuit > 2000, `(${p.powers.radsuit})`); }
// 열쇠가 실제로 문을 연다
{ const g = new Game(loadLevel(wad, 'E1M2'), 3); const k = g.mobjs.find((o) => o.pickup === 'blueCard' || o.pickup === 'yellowCard' || o.pickup === 'redCard');
  if (k) { const p = g.player; p.teleportTo(g, k.x, k.y, 0); p.reaction = 0; g.tick({ forward: 0, side: 0, turn: 0, use: false });
    const color = { blueCard: 'blue', yellowCard: 'yellow', redCard: 'red' }[k.pickup]; ok(`열쇠(${color}) 획득`, p.keys[color]); } else out.push('SKIP  E1M2 에 열쇠 없음'); }

// 5. 통은 이동을 막는다
{ const g = fresh(); const barrel = g.mobjs.find((o) => o.type === 2035); const p = g.player;
  if (barrel) { p.teleportTo(g, barrel.x - 60, barrel.y, 0); p.reaction = 0;
    for (let t = 0; t < 40; t++) g.tick({ forward: 50, side: 0, turn: 0, use: false });
    const d = Math.hypot(p.x - barrel.x, p.y - barrel.y);
    ok('통을 뚫고 지나가지 못함', Math.abs(p.x - barrel.x) >= 16 + barrel.radius - 0.01 || Math.abs(p.y - barrel.y) >= 16 + barrel.radius - 0.01, `(거리 ${d.toFixed(1)})`); }
  else out.push('SKIP  E1M1 에 통 없음'); }
console.log(out.join('\n'));

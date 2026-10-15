import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { Mobj } from '../src/game/mobj.js';
import { THING_INFO } from '../src/game/info.js';
import { checkSight, damageMobj } from '../src/game/combat.js';
import { sectorAt } from '../src/render/bsp.js';

const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false };
const tick = (g, n, cmd = NO) => { for (let i = 0; i < n; i++) g.tick(cmd); };

/** mon 이 보이고 걸어갈 수 있는 위치를 dist 부근에서 찾아 플레이어를 세운다 */
const placeFacing = (g, mon, dists = [200, 150, 260, 120, 320]) => {
  const p = g.player;
  for (const d of dists) for (let a = 0; a < 48; a++) {
    const ang = (a * Math.PI) / 24, x = mon.x + Math.cos(ang) * d, y = mon.y + Math.sin(ang) * d;
    const s = sectorAt(g.level, x, y);
    if (Math.abs(s.floorHeight - mon.sector.floorHeight) > 8 || g.physics.check(x, y, s.floorHeight).blocked) continue;
    const probe = { x, y, z: s.floorHeight, height: 56 };
    if (!checkSight(g, probe, mon)) continue;
    p.teleportTo(g, x, y, Math.atan2(mon.y - y, mon.x - x)); p.reaction = 0;
    return true;
  }
  return false;
};
/** 무기 교체를 기다리는 동안 깨어난 몬스터를 처음 자리/대기 상태로 되돌린다 */
const reset = (g, m, ox, oy) => { m.x = ox; m.y = oy; m.momx = m.momy = 0; m.target = null; m.threshold = 0; m.setState('stand', g); };
const find = (g, type) => g.mobjs.find((m) => m.type === type && !m.removed);
const loadGame = (map, seed = 7) => new Game(loadLevel(wad, map), 3, seed);
const sleepAll = (g) => { for (const m of g.mobjs) if (m.ai?.states.stand) { m.target = null; } };

// ---------- 1. 권총으로 좀비맨 잡기 + 탄창 드롭 ----------
{
  const g = loadGame('E1M1'); const p = g.player; const z = find(g, 3004);
  ok('E1M1 에 좀비맨 존재', !!z);
  const placed = placeFacing(g, z); ok('좀비맨이 보이는 위치 확보', placed);
  p.health = 500; p.ammo.clip = 50; const clip0 = p.ammo.clip;
  tick(g, 20);                                       // 무기가 올라올 때까지
  tick(g, 400, { ...NO, fire: true });
  ok('권총으로 좀비맨 사망', z.health <= 0 && z.corpse, `(hp ${z.health})`);
  ok('킬 카운트 증가', g.killsFound >= 1, `(${g.killsFound})`);
  ok('탄약 소모', p.ammo.clip < clip0, `(${clip0} → ${p.ammo.clip})`);
  const dropped = g.mobjs.find((m) => m.dropped && m.type === 2007);
  ok('좀비맨이 탄창을 떨어뜨림', !!dropped);
  ok('시체는 통과 가능 (solid 아님)', !z.solid && !g.physics.things.includes(z));
}

// ---------- 2. 샷건: 한 방에 정리 ----------
{
  const g = loadGame('E1M1'); const p = g.player; const z = find(g, 3004); const zx = z.x, zy = z.y;
  ok('샷건 시험: 좀비맨 앞 위치 확보', placeFacing(g, z, [110, 100, 130, 90, 150]));
  p.weapons.add('shotgun'); p.ammo.shell = 20; p.pendingWeapon = 'shotgun'; p.health = 500;
  tick(g, 50);
  ok('샷건으로 무기 교체 완료', p.readyWeapon === 'shotgun', `(${p.readyWeapon})`);
  reset(g, z, zx, zy);
  const before = p.ammo.shell;
  tick(g, 3, { ...NO, fire: true });
  tick(g, 2);
  ok('샷건 1발 → 셸 1 소모', before - p.ammo.shell === 1, `(${before} → ${p.ammo.shell})`);
  tick(g, 60);
  ok('샷건으로 좀비맨 사망', z.health <= 0, `(hp ${z.health})`);
}

// ---------- 3. 탄약이 떨어지면 다른 무기로 ----------
{
  const g = loadGame('E1M1'); const p = g.player;
  p.ammo.clip = 1; tick(g, 20);
  tick(g, 25, { ...NO, fire: true });   // 마지막 1발 사용
  tick(g, 40);
  ok('권총 탄약 0 → 주먹으로 자동 교체', p.readyWeapon === 'fist' && p.ammo.clip === 0, `(${p.readyWeapon}, ${p.ammo.clip})`);
}

// ---------- 4. 소음으로 몬스터가 깨어나 다가와서 공격한다 ----------
for (const [type, name, expect] of [[3004, 'zombieman', 'hitscan'], [3001, 'imp', 'ranged'], [3002, 'demon', 'melee']]) {
  let done = false;
  for (const map of ['E1M1', 'E1M2', 'E1M3', 'E1M4', 'E1M5', 'E1M6', 'E1M7']) {
    const g = loadGame(map, 7); const m = find(g, type); if (!m) continue;
    const p = g.player; if (!placeFacing(g, m, [220, 300, 160])) continue;
    p.health = 1000; p.powers.invuln = 0; m.ambush = false; m.angle = Math.atan2(p.y - m.y, p.x - m.x);
    const d0 = Math.hypot(m.x - p.x, m.y - p.y), hp0 = p.health;
    tick(g, 30);
    const woke = !m.is('stand');
    let dMin = d0; for (let t = 0; t < 700; t++) { g.tick(NO); dMin = Math.min(dMin, Math.hypot(m.x - p.x, m.y - p.y)); }
    ok(`${name}(${map}): 플레이어를 보고 깨어남`, woke);
    ok(`${name}: 공격해서 플레이어 체력 감소 (${expect})`, p.health < hp0, `(${hp0} → ${p.health}, 최근접 ${dMin.toFixed(0)})`);
    done = true; break;
  }
  if (!done) out.push(`SKIP  ${name} 시험 가능한 위치 없음`);
}

// ---------- 5. 통 폭발: 근처 몬스터에게 피해, 통은 사라짐 ----------
{
  const g = loadGame('E1M1'); const p = g.player; const barrel = find(g, 2035);
  ok('통 시험: 통이 보이는 위치 확보', placeFacing(g, barrel, [150, 200, 110])); p.health = 500; tick(g, 20);
  // 통 옆(반대쪽 포함 8방향 중 자유로운 곳)에 좀비맨을 하나 세운다
  let zom = null;
  for (let a = 0; a < 16 && !zom; a++) {
    const x = barrel.x + Math.cos(a * Math.PI / 8) * 55, y = barrel.y + Math.sin(a * Math.PI / 8) * 55;
    const s2 = sectorAt(g.level, x, y);
    if (Math.abs(s2.floorHeight - barrel.sector.floorHeight) > 8 || g.physics.check(x, y, s2.floorHeight, 56, 20, { monster: true }).blocked) continue;
    if (!checkSight(g, { x, y, z: s2.floorHeight, height: 56 }, barrel)) continue;
    zom = new Mobj(3004, THING_INFO[3004], x, y, 0, s2); g.addMobj(zom);
  }
  ok('통 옆에 좀비맨 배치', !!zom);
  const hp0 = zom.health;
  tick(g, 200, { ...NO, fire: true });
  ok('통이 폭발해서 사라짐', barrel.removed || barrel.is('die'), `(${barrel.stateLabel}, removed ${barrel.removed})`);
  ok('폭발 범위 안의 몬스터가 피해/사망', zom.health < hp0, `(${hp0} → ${zom.health})`);
}

// ---------- 6. 로켓: 직격 + 범위 피해 ----------
{
  const g = loadGame('E1M1'); const p = g.player; const z = find(g, 3004);
  placeFacing(g, z, [250, 300, 200]); p.health = 500;
  p.weapons.add('rocketLauncher'); p.ammo.rocket = 5; p.pendingWeapon = 'rocketLauncher';
  tick(g, 50);
  const r0 = p.ammo.rocket;
  tick(g, 4, { ...NO, fire: true });
  tick(g, 400);
  ok('로켓 1발 소모', r0 - p.ammo.rocket >= 1, `(${r0} → ${p.ammo.rocket})`);
  ok('로켓으로 좀비맨 사망', z.health <= 0, `(hp ${z.health})`);
  ok('로켓/폭발 효과가 끝나서 정리됨', !g.mobjs.some((m) => m.missile), `(날아다니는 투사체 ${g.mobjs.filter((m) => m.missile).length})`);
}

// ---------- 7. 주먹 ----------
{
  const g = loadGame('E1M1'); const p = g.player; const z = find(g, 3004); const z0x = z.x, z0y = z.y;
  ok('주먹 시험: 좀비맨 바로 앞 위치 확보', placeFacing(g, z, [52, 48, 56, 60, 44])); p.health = 500; p.pendingWeapon = 'fist'; tick(g, 50);
  reset(g, z, z0x, z0y);
  const hp0 = z.health;
  tick(g, 100, { ...NO, fire: true });
  ok('주먹이 맞아서 몬스터 체력 감소', z.health < hp0, `(${hp0} → ${z.health})`);
}

// ---------- 8. E1M8: 바론 둘이 죽으면 출구 쪽 바닥이 내려간다 ----------
{
  const g = loadGame('E1M8'); const barons = g.mobjs.filter((m) => m.type === 3003);
  const sec = g.level.sectors.filter((s) => s.tag === 666); const f0 = sec.map((s) => s.floorHeight);
  ok('E1M8 에 바론 존재, 태그 666 섹터 존재', barons.length >= 2 && sec.length > 0, `(바론 ${barons.length}, 섹터 ${sec.length})`);
  for (const m of barons) damageMobj(g, m, null, g.player, 5000);
  tick(g, 150);
  ok('바론 전멸 → 태그 666 바닥 하강', sec.some((s, i) => s.floorHeight < f0[i]), `(${f0.join(',')} → ${sec.map((s) => s.floorHeight).join(',')})`);
}

// ---------- 9. 9개 맵 소크 테스트: 무작위 이동+사격을 오래, 예외/NaN/갇힘 없음 ----------
for (const map of wad.getMapNames()) {
  const g = loadGame(map, 5); const p = g.player;
  p.weapons.add('shotgun'); p.weapons.add('chaingun'); p.weapons.add('rocketLauncher');
  p.ammo = { clip: 999, shell: 999, rocket: 999, cell: 0 }; p.maxAmmo = { clip: 999, shell: 999, rocket: 999, cell: 0 };
  let err = null, bad = 0, maxMissiles = 0, maxMobjs = 0, ang = 0, deadAt = -1;
  try {
    for (let t = 0; t < 6000; t++) {
      if (t % 50 === 0) ang += (g.rnd() / 255 - 0.5) * 3;
      if (t % 200 === 0) p.pendingWeapon = ['pistol', 'shotgun', 'chaingun', 'rocketLauncher'][g.rnd() & 3];
      p.powers.invuln = 100; p.health = 100;      // 죽지 않게 해서 오래 시험
      g.tick({ forward: g.rnd() < 200 ? 50 : 0, side: 0, turn: (ang - p.angle) * 0.2, use: g.rnd() < 30, fire: g.rnd() < 170, weapon: 0 });
      if (g.exited) g.exited = null;
      maxMissiles = Math.max(maxMissiles, g.mobjs.filter((m) => m.missile).length);
      maxMobjs = Math.max(maxMobjs, g.mobjs.length);
      if (t % 100 === 0) for (const m of g.mobjs) {
        if (!Number.isFinite(m.x + m.y + m.z)) bad++;
        if (m.ai && !m.ai.effect && !m.missile && !m.removed) {
          const s = sectorAt(g.level, m.x, m.y);
          if (m.z < s.floorHeight - 64 || m.z > s.ceilingHeight + 64) bad++;
        }
      }
    }
  } catch (e) { err = e.stack.split('\n').slice(0, 4).join(' | '); }
  const alive = g.mobjs.filter((m) => m.info.monster && m.health > 0).length;
  const awake = g.mobjs.filter((m) => m.info.monster && m.health > 0 && !m.is('stand')).length;
  console.log(map.padEnd(5), err ? `ERROR ${err}` : `ok  bad=${bad}  킬 ${g.killsFound}/${g.killsTotal}  생존 ${alive} (깨어 있음 ${awake})  동시 투사체 ≤${maxMissiles}  물체 ≤${maxMobjs}`);
}

console.log(out.join('\n'));

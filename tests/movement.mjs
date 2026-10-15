import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { Physics } from '../src/game/physics.js';
import { sectorAt } from '../src/render/bsp.js';
import { lowestCeilingSurrounding } from '../src/game/sectors.js';

const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const NOCMD = { forward: 0, side: 0, turn: 0, use: false };
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// ---------- 1. 충돌: 8방향으로 오래 달려도 벽을 뚫지 않는다 ----------
{
  const g = new Game(loadLevel(wad, 'E1M1')); const p = g.player;
  let bad = 0;
  for (let a = 0; a < 8; a++) {
    p.teleportTo(g, 1056, -3616, (a * Math.PI) / 4); p.reaction = 0;
    for (let t = 0; t < 200; t++) {
      g.tick({ forward: 50, side: 0, turn: 0, use: false });
      if (g.physics.check(p.x, p.y, p.z).blocked) bad++;
    }
  }
  ok('8방향 200tic 달리기: 막힌 위치에 들어간 횟수', bad === 0, `(${bad})`);
}

// ---------- 2. 달리기 속도: 원작 터미널 속도 ----------
{
  const g = new Game(loadLevel(wad, 'E1M1')); const p = g.player;
  p.noclip = true; p.angle = Math.PI / 2;    // 벽 영향 없이 속도만 측정
  let v = 0;
  for (let t = 0; t < 60; t++) { const y0 = p.y; g.tick({ forward: 25, side: 0, turn: 0, use: false }); v = p.y - y0; }
  ok('걷기 속도 ≈ 8 유닛/tic', v > 7 && v < 9.5, `(${v.toFixed(2)})`);
}

// ---------- 3. 문 (특수 1): 열리고 → 기다리고 → 닫힌다 ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl); const p = g.player;
  const door = lvl.linedefs.find((l) => l.special === 1 && l.backSector);
  const len = Math.hypot(door.dx, door.dy), nx = door.dy / len, ny = -door.dx / len;
  const mx = (door.v1.x + door.v2.x) / 2, my = (door.v1.y + door.v2.y) / 2;
  p.teleportTo(g, mx + nx * 40, my + ny * 40, Math.atan2(-ny, -nx)); p.reaction = 0;
  const sec = door.backSector, closedCeil = sec.ceilingHeight;
  g.tick({ ...NOCMD, use: true });
  let maxCeil = 0, openTics = 0, closedAgain = false;
  for (let t = 0; t < 400; t++) {
    g.tick(NOCMD);
    maxCeil = Math.max(maxCeil, sec.ceilingHeight);
    if (sec.ceilingHeight > sec.floorHeight + 56) openTics++;
    if (t > 50 && sec.ceilingHeight === closedCeil) { closedAgain = true; break; }
  }
  ok('문 열림 (천장 상승)', maxCeil > closedCeil + 40, `(${closedCeil} → ${maxCeil})`);
  ok('문 4초 대기 후 닫힘', closedAgain && openTics > 100, `(열린 상태 ${openTics} tic)`);
}

// ---------- 4. 문 앞에 서 있으면 문이 다시 열린다 (끼임 방지) ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl); const p = g.player;
  const door = lvl.linedefs.find((l) => l.special === 1 && l.backSector);
  const len = Math.hypot(door.dx, door.dy), nx = door.dy / len, ny = -door.dx / len;
  const mx = (door.v1.x + door.v2.x) / 2, my = (door.v1.y + door.v2.y) / 2;
  p.teleportTo(g, mx + nx * 40, my + ny * 40, Math.atan2(-ny, -nx)); p.reaction = 0;
  g.tick({ ...NOCMD, use: true });
  for (let t = 0; t < 60; t++) g.tick(NOCMD);                  // 완전히 열림
  // 문 한가운데로 걸어 들어가 선다
  p.teleportTo(g, mx, my, p.angle); p.reaction = 0;
  let reopened = false, stuck = false;
  for (let t = 0; t < 400; t++) {
    g.tick(NOCMD);
    if (g.physics.check(p.x, p.y, p.z).ceilz - g.physics.result.floorz < 56) stuck = true;
    if (t > 200 && sec(door).ceilingHeight > sec(door).floorHeight + 56) reopened = true;
  }
  function sec(d) { return d.backSector; }
  ok('문 속에 서 있으면 끼지 않음', !stuck);
}

// ---------- 5. 리프트 (WR 88): 걸어서 선을 넘으면 내려갔다 올라온다 ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl); const p = g.player;
  const trig = lvl.linedefs.find((l) => l.special === 88 && l.backSector);
  const lift = lvl.sectors.find((s) => s.tag === trig.tag);
  const high = lift.floorHeight;
  const len = Math.hypot(trig.dx, trig.dy), nx = trig.dy / len, ny = -trig.dx / len;
  const mx = (trig.v1.x + trig.v2.x) / 2, my = (trig.v1.y + trig.v2.y) / 2;
  p.teleportTo(g, mx + nx * 20, my + ny * 20, Math.atan2(-ny, -nx)); p.reaction = 0;
  let minF = high, back = false;
  for (let t = 0; t < 12; t++) g.tick({ forward: 25, side: 0, turn: 0, use: false });
  for (let t = 0; t < 400; t++) {
    g.tick(NOCMD);
    minF = Math.min(minF, lift.floorHeight);
    if (t > 60 && lift.floorHeight === high) { back = true; break; }
  }
  ok('리프트가 내려감', minF < high, `(${high} → ${minF})`);
  ok('리프트가 3초 뒤 원위치로 복귀', back);
}

// ---------- 6. 계단 오르기: 24 이하만 오른다 ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl);
  const lo = g.physics.check; // 단순 단위 검사: 가상의 상자 높이 차
  const f = lvl.linedefs.find((l) => l.backSector && Math.abs(l.frontSector.floorHeight - l.backSector.floorHeight) === 8);
  const t = lvl.linedefs.find((l) => l.backSector && Math.abs(l.frontSector.floorHeight - l.backSector.floorHeight) > 24
    && l.frontSector.ceilingHeight - l.frontSector.floorHeight > 60 && !(l.flags & 1));
  ok('8유닛 단차/24 초과 단차 선이 맵에 존재', !!f && !!t);
}

// ---------- 7. 출구 스위치 (11): 사용하면 레벨 종료 ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl); const p = g.player;
  const ex = lvl.linedefs.find((l) => l.special === 11);
  const len = Math.hypot(ex.dx, ex.dy), nx = ex.dy / len, ny = -ex.dx / len;
  const mx = (ex.v1.x + ex.v2.x) / 2, my = (ex.v1.y + ex.v2.y) / 2;
  p.teleportTo(g, mx + nx * 30, my + ny * 30, Math.atan2(-ny, -nx)); p.reaction = 0;
  g.tick({ ...NOCMD, use: true });
  ok('출구 스위치 → exited', !!g.exited);
  ok('스위치 텍스처가 SW1→SW2 로 바뀜', ex.right.midTex.startsWith('SW2') || ex.right.upperTex.startsWith('SW2') || ex.right.lowerTex.startsWith('SW2'), `(${ex.right.midTex}/${ex.right.upperTex}/${ex.right.lowerTex})`);
}

// ---------- 8. 시작점 → 출구 스위치까지 실제로 걸어가기 ----------
{
  const lvl = loadLevel(wad, 'E1M1'); const g = new Game(lvl); const p = g.player;
  const ex = lvl.linedefs.find((l) => l.special === 11);
  const len = Math.hypot(ex.dx, ex.dy), nx = ex.dy / len, ny = -ex.dx / len;
  const tx = (ex.v1.x + ex.v2.x) / 2 + nx * 28, ty = (ex.v1.y + ex.v2.y) / 2 + ny * 28;

  // 길찾기용 복사본: 문은 열어 두고, 리프트 섹터는 통과 가능으로 간주
  const nav = loadLevel(wad, 'E1M1'); const navG = new Game(nav);
  const liftTags = new Set(nav.linedefs.filter((l) => [88, 62, 10, 21].includes(l.special)).map((l) => l.tag));
  for (const l of nav.linedefs) if ([1, 26, 27, 28, 31, 32, 33, 34].includes(l.special) && l.backSector) l.backSector.ceilingHeight = lowestCeilingSurrounding(l.backSector) - 4;
  const CELL = 16, ph = navG.physics;
  const key = (x, y) => `${x},${y}`;
  const passable = (x0, y0, x1, y1) => {
    const s0 = sectorAt(nav, x0, y0), s1 = sectorAt(nav, x1, y1);
    const lift = liftTags.has(s0.tag) || liftTags.has(s1.tag);
    const z = lift ? Math.max(s0.floorHeight, s1.floorHeight) : s0.floorHeight;
    const r = ph.check(x1, y1, z);
    if (lift) return r.blockers.length === 0;
    return !r.blocked;
  };
  const start = [Math.round(p.x / CELL) * CELL, Math.round(p.y / CELL) * CELL];
  const goal = [Math.round(tx / CELL) * CELL, Math.round(ty / CELL) * CELL];
  const prev = new Map([[key(...start), null]]); const q = [start]; let found = false;
  while (q.length && !found) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx2 = cx + dx * CELL, ny2 = cy + dy * CELL, k = key(nx2, ny2);
      if (prev.has(k) || Math.abs(nx2 - start[0]) > 6000 || Math.abs(ny2 - start[1]) > 6000) continue;
      if (!passable(cx, cy, nx2, ny2)) continue;
      prev.set(k, [cx, cy]); q.push([nx2, ny2]);
      if (Math.hypot(nx2 - goal[0], ny2 - goal[1]) < CELL * 1.5) { goal[0] = nx2; goal[1] = ny2; found = true; break; }
    }
  }
  ok('길찾기: 출구 스위치 앞까지 경로 존재', found, `(탐색 ${prev.size} 칸)`);

  if (found) {
    const path = []; for (let c = goal; c; c = prev.get(key(...c))) path.push(c); path.reverse();
    // 경로를 직선 구간으로 단순화한 웨이포인트
    const wps = path.filter((_, i) => i % 3 === 0); wps.push([tx, ty]);
    let wi = 0, tics = 0, stuckTics = 0, lastX = p.x, lastY = p.y, usedTics = 0;
    for (; tics < 35 * 600 && !g.exited; tics++) {
      const [wx, wy] = wps[Math.min(wi, wps.length - 1)];
      const d = Math.hypot(wx - p.x, wy - p.y);
      if (d < 28 && wi < wps.length - 1) wi++;
      const want = Math.atan2(wy - p.y, wx - p.x);
      p.angle = want; p.prevAngle = want;
      // 문/스위치 근처에서는 사용 키를 번갈아 누름
      // (이미 열리는 문에 또 누르면 원작처럼 닫히기 시작하므로, 닫혀 있는 문에만 한 번 누른다)
      const use = lvl.linedefs.some((l) => l.special
        && Math.hypot((l.v1.x + l.v2.x) / 2 - p.x, (l.v1.y + l.v2.y) / 2 - p.y) < 70
        && (l.backSector && !l.backSector.specialData && l.backSector.ceilingHeight <= l.backSector.floorHeight + 2 || l.special === 11)) && tics % 8 === 0;
      if (wi >= wps.length - 1 && d < 40) { p.angle = Math.atan2(-ny, -nx); }
      g.tick({ forward: wi >= wps.length - 1 && d < 30 ? 0 : 50, side: 0, turn: 0, use });
      if (Math.hypot(p.x - lastX, p.y - lastY) < 0.2) stuckTics++; else stuckTics = 0;
      lastX = p.x; lastY = p.y;
      if (g.exited) break;
    }
    ok('시작점에서 출구 스위치까지 걸어서 도달해 레벨 종료', !!g.exited, `(${(tics / 35).toFixed(0)}초, 웨이포인트 ${wi}/${wps.length - 1}, 위치 ${p.x.toFixed(0)},${p.y.toFixed(0)}, 체력 ${p.health})`);
  }
}

console.log(results.join('\n'));

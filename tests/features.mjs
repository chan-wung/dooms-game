import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { loadLevel } from '../src/wad/level.js';
import { Game } from '../src/game/game.js';
import { saveGame, loadGame } from '../src/game/savegame.js';
import { loadPalette } from '../src/gfx/palette.js';
import { Renderer, SCREEN_W, SCREEN_H, viewWindow } from '../src/render/renderer.js';
import { TextureStore } from '../src/gfx/textures.js';
import { SpriteStore } from '../src/gfx/sprites.js';
import { sectorAt } from '../src/render/bsp.js';
import { Wipe } from '../src/render/wipe.js';
import { Menu } from '../src/ui/menu.js';
import { CheatTyper, cheatChar, toggleGod, toggleNoclip, giveKfa, giveFa, togglePower } from '../src/game/cheats.js';

/** 애니메이션 텍스처 · 텔레프래그 · 치트 · 감마 · 녹는 전환 · 화면 크기 · 죽음 · 메뉴 */
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const NO = { forward: 0, side: 0, turn: 0, use: false, fire: false, weapon: 0, cycle: 0 };
const tick = (g, n) => { for (let i = 0; i < n; i++) g.tick(NO); };

// ---------- 애니메이션 텍스처 ----------
{
  const ts = new TextureStore(wad);
  ok('애니메이션: 이 WAD 에 있는 묶음만 등록 (슬라임 바닥, 벽 SLADRIP)', ts.anims.length === 2 && ts.anims.some((a) => a.frames[0] === 'NUKAGE1') && ts.anims.some((a) => a.frames[0] === 'SLADRIP1'), `(${ts.anims.map((a) => a.frames[0])})`);
  const flat = ts.flat('NUKAGE1'), wall = ts.texture('SLADRIP1');
  const same = (a, b2) => a.length === b2.length && a.every((v, i) => v === b2[i]);
  const frames = [1, 2, 3].map((n) => ts.baseFlat(`NUKAGE${n}`)), walls = [1, 2, 3].map((n) => ts.baseTexture(`SLADRIP${n}`));
  const seq = [0, 8, 16, 24, 32].map((t) => { ts.animate(t); return [frames.findIndex((f) => same(flat, f)), walls.findIndex((w) => same(wall.data, w.data))]; });
  ok('애니메이션: 8tic 마다 바닥이 1→2→3→1 로 돈다', seq.map((x) => x[0]).join() === '0,1,2,0,1', `(${seq.map((x) => x[0])})`);
  ok('애니메이션: 벽도 같이 돈다', seq.map((x) => x[1]).join() === '0,1,2,0,1');
  ts.animate(39);
  ok('애니메이션: 8tic 이 안 지나면 그대로 (32~39 는 같은 프레임)', same(flat, frames[1]));
  ok('애니메이션: 같은 이름은 늘 같은 객체 (렌더러 캐시와 충돌 없음)', ts.flat('NUKAGE1') === flat && ts.texture('SLADRIP1') === wall);
  ok('애니메이션: 묶음 밖 텍스처(스위치)는 그대로', !ts.texProxy.has('SW1BRCOM') && ts.texture('SW1BRCOM') === ts.texture('SW1BRCOM'));

  // 렌더러가 실제로 움직이는 프레임을 그린다: 슬라임이 보이는 시점에서 시간이 지나면 화면이 달라진다
  const gfx = { palette: loadPalette(wad), textures: ts, sprites: new SpriteStore(wad) };
  let changed = false;
  const lvl = loadLevel(wad, 'E1M3'), r = new Renderer(gfx);
  const slime = lvl.sectors.find((sc) => /^NUKAGE/.test(sc.floorTex) && sc.lines.length >= 4);
  const xs = slime.lines.flatMap((l) => [l.v1.x, l.v2.x]), ys = slime.lines.flatMap((l) => [l.v1.y, l.v2.y]);
  let spot = null;                                                  // 슬라임 섹터 안의 한 점
  for (let x = Math.min(...xs); x <= Math.max(...xs) && !spot; x += 8) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 8) if (sectorAt(lvl, x, y) === slime) { spot = { x, y }; break; }
  for (let k = 0; k < 8 && !changed; k++) {
    const view = { x: spot.x, y: spot.y, angle: (k * Math.PI) / 4, z: slime.floorHeight + 41 };
    ts.animate(0); r.render(lvl, view, []); const a0 = r.pixels.slice();
    ts.animate(8); r.render(lvl, view, []); const a1 = r.pixels.slice();
    changed = a0.some((v, i) => v !== a1[i]);
  }
  ok('애니메이션: 같은 시점인데 8tic 뒤 화면이 달라진다 (슬라임 방)', changed);
}

// ---------- 텔레포트: 텔레프래그, 안개, 몬스터 ----------
{
  const g = new Game(loadLevel(wad, 'E1M5'), 3, 1), sp = g.specials;
  const ld = g.level.linedefs.find((l) => l.special === 39 || l.special === 97);
  const target = sp.sectorsWithTag(ld.tag).map((sc) => g.level.things.find((t) => t.type === 14 && sectorAt(g.level, t.x, t.y) === sc)).find(Boolean);
  ok('텔레포트: E1M5 에 선과 도착 지점이 있다', !!ld && !!target);
  const monsters = g.mobjs.filter((m) => m.info.monster && m.shootable);
  const mon = monsters[0];
  mon.x = target.x; mon.y = target.y; mon.sector = sectorAt(g.level, mon.x, mon.y); mon.z = mon.sector.floorHeight;
  const fogCount = () => g.mobjs.filter((m) => m.sprite === 'TFOG' && !m.removed).length;
  const sounds = []; g.onSound = (n) => sounds.push(n);
  const kills = g.killsFound;
  const did = sp.teleport(ld, 0, g.player);
  ok('텔레프래그: 플레이어가 도착하면 그 자리의 몬스터가 죽는다', did && !mon.shootable && mon.corpse && g.killsFound === kills + 1);
  ok('텔레프래그: 플레이어가 도착 지점으로 옮겨졌다', Math.hypot(g.player.x - target.x, g.player.y - target.y) < 1);
  ok('텔레포트 안개: 출발·도착 두 곳에 생긴다', fogCount() === 2, `(${fogCount()})`);
  ok('텔레포트 소리: 두 번', sounds.filter((n) => n === 'TELEPT').length === 2);
  tick(g, 6 * 12 + 2);
  ok('텔레포트 안개: 약 2초 뒤 사라진다', fogCount() === 0);

  const m2 = monsters[1], blocker = monsters[2], m3 = monsters[3];
  blocker.x = target.x; blocker.y = target.y;
  ok('텔레포트: 몬스터는 도착 지점에 다른 몬스터가 있으면 실패', sp.teleport(ld, 0, m2) === false);
  blocker.x = target.x + 900; blocker.y = target.y + 900;
  ok('텔레포트: 비어 있으면 몬스터도 이동', sp.teleport(ld, 0, m2) === true && Math.hypot(m2.x - target.x, m2.y - target.y) < 1);
  m2.x = target.x + 900; m2.y = target.y - 900;                   // 도착 지점을 다시 비운다
  // 몬스터가 선을 가로지르면 (앞쪽 → 뒤쪽이 아니라 앞면으로 들어가면) 작동
  const cx = (ld.v1.x + ld.v2.x) / 2, cy = (ld.v1.y + ld.v2.y) / 2, nx = -ld.dy, ny = ld.dx, nl = Math.hypot(nx, ny);
  let moved = false;
  for (const sign of [1, -1]) {
    const a = [cx + sign * (nx / nl) * 4, cy + sign * (ny / nl) * 4], bpos = [cx - sign * (nx / nl) * 4, cy - sign * (ny / nl) * 4];
    m3.x = bpos[0]; m3.y = bpos[1];
    g.specials.crossLines(m3, a[0], a[1]);
    if (Math.hypot(m3.x - target.x, m3.y - target.y) < 1) moved = true;
    if (moved) break;
    ld.special = ld.special || 97;
  }
  ok('텔레포트: 몬스터가 텔레포트 선을 밟으면 순간이동', moved);
}

// ---------- 치트 ----------
{
  const g = new Game(loadLevel(wad, 'E1M1'), 3, 1), p = g.player;
  toggleGod(g); p.damage(50, g);
  ok('IDDQD: 맞아도 체력이 그대로', p.god && p.health === 100);
  toggleGod(g); p.damage(30, g);
  ok('IDDQD: 한 번 더 치면 꺼진다', !p.god && p.health === 70);
  giveKfa(g);
  ok('IDKFA: 무기 전부·탄약 최대·열쇠·파란 방어구', ['shotgun', 'chaingun', 'chainsaw', 'rocketLauncher'].every((w) => p.weapons.has(w)) && p.ammo.shell === p.maxAmmo.shell && p.keys.red && p.armor === 200 && p.armorType === 2);
  const g2 = new Game(loadLevel(wad, 'E1M1'), 3, 1); giveFa(g2);
  ok('IDFA: 열쇠는 주지 않는다', g2.player.weapons.has('shotgun') && !g2.player.keys.red);
  toggleNoclip(g); ok('IDCLIP: 켜짐', p.noclip); toggleNoclip(g); ok('IDCLIP: 꺼짐', !p.noclip);
  togglePower(g, 'invuln'); ok('IDBEHOLD V: 무적', p.powers.invuln > 0); togglePower(g, 'invuln'); ok('IDBEHOLD V: 한 번 더 치면 꺼짐', p.powers.invuln === 0);
  const t = new CheatTyper(), type = (str) => { let hit = null; for (const c of str) hit = t.feed(c, 0) ?? hit; return hit; };
  ok('치트 입력: iddqd', type('iddqd')?.name === 'god');
  ok('치트 입력: 앞에 엉뚱한 글자가 섞여도 (xxidkfa)', type('xxidkfa')?.name === 'kfa');
  ok('치트 입력: idbeholds → 버서크', JSON.stringify(type('idbeholds')) === '{"name":"power","arg":"berserk"}');
  ok('치트 입력: idclev12 → E1M2', JSON.stringify(type('idclev12')) === '{"name":"warp","arg":"E1M2"}');
  type('id'); ok('치트 입력: 치는 중에는 active (다른 단축키가 끼어들지 않게)', t.active);
  t.feed('x', 0); ok('치트 입력: 틀리면 풀린다', !t.active);
  ok('치트 입력: WASD·E·R 같은 평소 키는 가로채지 않는다', !['w', 'a', 's', 'd', 'e', 'r', 'f'].some((c) => { const tt = new CheatTyper(); tt.feed(c, 0); return tt.active; }));
  ok('치트 입력: KeyD → d, Digit1 → 1', cheatChar('KeyD') === 'd' && cheatChar('Digit1') === '1' && cheatChar('ShiftLeft') === null);
  p.god = true;
  const loaded = loadGame(loadLevel(wad, 'E1M1'), 3, JSON.parse(JSON.stringify(saveGame(g))));
  ok('치트: god 가 저장되고 불러와진다', loaded.player.god === true);
  ok('치트: 다음 맵으로 god 이어짐', new Game(loadLevel(wad, 'E1M2'), 3, 1, g.player.exportState()).player.god === true);
}

// ---------- 밝기(감마) ----------
{
  const pal = loadPalette(wad), lit = pal.lit, dark0 = pal.lit[20][100], c0 = pal.lit[0][100];
  pal.setGamma(4);
  ok('감마: 밝기를 올리면 어두운 단계가 밝아진다', (pal.lit[20][100] & 255) > (dark0 & 255) && pal.gamma === 4);
  ok('감마: 표를 제자리에서 고친다 (렌더러가 쥔 참조가 그대로 유효)', pal.lit === lit && pal.litFor(0) === lit);
  pal.setGamma(0);
  ok('감마: 0 으로 돌리면 원래 색', pal.lit[0][100] === c0 && pal.lit[20][100] === dark0);
  const base = loadPalette(wad).litFor(3)[0][100]; pal.litFor(3); pal.setGamma(2);
  ok('감마: 색조 팔레트도 함께 바뀐다', pal.litFor(3)[0][100] !== base);
}

// ---------- 녹는 전환 ----------
{
  const w = new Wipe((() => { let n = 7; return () => (n = (n * 37 + 11) % 256); })());
  const old = new Uint32Array(SCREEN_W * SCREEN_H).fill(0xffff0000), cur = new Uint32Array(SCREEN_W * SCREEN_H).fill(0xff00ff00);
  w.start(old);
  const first = cur.slice(); w.draw(first);
  const oldShare = first.filter((v) => v === 0xffff0000).length / first.length;
  ok('녹는 전환: 시작 직후에는 옛 화면이 대부분', oldShare > 0.9, `(${oldShare.toFixed(2)})`);
  let n = 0; while (!w.done && n < 400) { w.tick(); n++; }
  const last = cur.slice(); w.draw(last);
  ok('녹는 전환: 끝나면 새 화면 (원작처럼 2초 안에)', w.done && n < 70 && last.every((v) => v === 0xff00ff00), `(${n}tic)`);
  w.start(old); for (let i = 0; i < 20; i++) w.tick();
  const mid = cur.slice(); w.draw(mid);
  const share = mid.filter((v) => v === 0xff00ff00).length / mid.length;
  ok('녹는 전환: 중간에는 두 화면이 섞인다', share > 0.02 && share < 0.98, `(${share.toFixed(2)})`);
}

// ---------- 화면 크기 ----------
{
  const w11 = viewWindow(11), w10 = viewWindow(10), w3 = viewWindow(3), w7 = viewWindow(7);
  ok('화면 크기: 11 = 전체 화면, 10 = 상태바 위', w11.h === 200 && w10.h === 168 && w10.w === 320);
  ok('화면 크기: 작은 창은 가운데 (원작 R_SetViewSize)', w3.w === 96 && w3.h === 48 && w3.x === 112 && w7.w === 224 && w7.h === 112 && w7.x === 48 && w7.y === 28, `(${JSON.stringify(w7)})`);
  const gfx = { palette: loadPalette(wad), textures: new TextureStore(wad), sprites: new SpriteStore(wad) };
  const g = new Game(loadLevel(wad, 'E1M1'), 3, 1);
  for (const blocks of [3, 7, 10, 11]) {
    const frame = new Uint32Array(SCREEN_W * SCREEN_H), r = new Renderer(gfx, frame);
    r.setViewSize(blocks);
    let err = null;
    try { r.render(g.level, { x: g.player.x, y: g.player.y, angle: g.player.angle, z: g.player.viewz }, g.mobjs); } catch (e) { err = e; }
    const win = r.window;
    const inside = (x, y) => x >= win.x && x < win.x + win.w && y >= win.y && y < win.y + win.h;
    let filled = 0, leaked = 0;
    for (let y = 0; y < SCREEN_H; y++) for (let x = 0; x < SCREEN_W; x++) {
      const nonBlack = frame[y * SCREEN_W + x] !== 0xff000000;
      if (inside(x, y) && nonBlack) filled++;
      if (!inside(x, y) && nonBlack) leaked++;
    }
    ok(`화면 크기 ${blocks}: 오류 없이 그리고 창 밖은 건드리지 않는다`, !err && filled > win.w * win.h * 0.5 && leaked === 0, `(채움 ${filled}/${win.w * win.h}, 밖 ${leaked}${err ? ` ${err.message}` : ''})`);
  }
}

// ---------- 죽은 뒤 ----------
{
  const g = new Game(loadLevel(wad, 'E1M1'), 3, 1), p = g.player;
  const killer = g.mobjs.find((m) => m.info.monster);
  killer.x = p.x; killer.y = p.y + 300;                              // 플레이어 위쪽(+y)
  p.angle = 0; p.damage(500, g, killer);
  const USE = { ...NO, use: true };
  g.tick(NO); const a1 = p.angle;
  tick(g, 30);
  ok('죽음: 죽인 상대 쪽으로 천천히 돌아본다', p.dead && Math.abs(p.angle - Math.PI / 2) < 0.01 && a1 > 0 && a1 < 0.2, `(${a1.toFixed(2)} → ${p.angle.toFixed(2)})`);
  const q = new Game(loadLevel(wad, 'E1M1'), 3, 1); q.player.damage(500, q); q.tick(USE);
  ok('죽음: 처음 1초는 USE 를 눌러도 넘어가지 않는다', !q.player.respawn);
  tick(g, 10); g.tick(USE);
  ok('죽음: 1초 뒤 USE → 다시 시작 요청', p.respawn === true);
}

// ---------- 메뉴: 뒤로가기 · 확인 창 ----------
{
  const log = []; let hasGame = false;
  const fakeHud = { patch: () => null, blit() {}, text() {}, textWidth: () => 0 };
  const actions = {
    maps: () => ['E1M1', 'E1M2'], currentMap: () => null, warp: (n) => log.push(`warp ${n}`), hasGame: () => hasGame, hasAuto: () => true,
    canSave: () => hasGame, newGame: (s) => { log.push(`new ${s}`); menu.close(); }, slotNames: () => [], loadSlot: (n) => { log.push(`load ${n}`); return true; }, saveSlot: () => true,
    quitToTitle: () => { log.push('quit'); menu.show('title'); }, settingsChanged: () => log.push('settings'), play: () => {}, resume: () => log.push('resume'),
    cheat: (name, arg) => log.push(`cheat ${name} ${arg ?? ''}`.trim()), cheatInfo: () => ({ god: false, noclip: false, automap: 0 }),
  };
  const settings = { sfx: 8, music: 8, sens: 5, skill: 3, messages: 1, screenSize: 10, gamma: 0 };
  const menu = new Menu(fakeHud, actions, settings);
  const ids = () => menu.layout().items.map((i) => i.id);
  const click = (id) => { const it = menu.layout().items.find((i) => i.id === id); menu.pointer(it.rx0 + 2, it.y + 2, true); };
  const back = () => menu.pointer(10, 10, true);

  menu.show('main');
  ok('메뉴: 게임이 없고 AUTO 저장이 있으면 CONTINUE 가 맨 위', ids()[0] === 'continue' && ids().includes('help'));
  click('continue'); ok('메뉴: CONTINUE → AUTO 슬롯 불러오기', log.includes('load 0'));
  menu.show('main'); click('new'); ok('메뉴: NEW GAME → 난이도', menu.state === 'skill');
  back(); ok('메뉴: 난이도에서 BACK 탭 → 메인으로', menu.state === 'main' && menu.layout().items[menu.cursor].id === 'new');
  menu.key('Escape'); ok('메뉴: 게임 없이 메인에서 Esc → 타이틀', menu.state === 'title');
  for (const [state, opener] of [['options', 'options'], ['load', 'load'], ['skill', 'new']]) {
    menu.show('main'); click(opener); const inState = menu.state === state; back();
    ok(`메뉴: ${state} 에서 BACK 탭 → 메인`, inState && menu.state === 'main');
  }
  menu.show('main'); click('options'); click('sound'); ok('메뉴: 옵션 → 소리', menu.state === 'sound'); back();
  ok('메뉴: 소리에서 BACK → 옵션 (소리 항목에 커서)', menu.state === 'options' && menu.layout().items[menu.cursor].id === 'sound');
  click('cheats'); ok('메뉴: 옵션 → CHEATS', menu.state === 'cheats'); back(); ok('메뉴: CHEATS 에서 BACK → 옵션', menu.state === 'options');

  // 게임 중: RESUME, 새 게임은 확인을 거친다
  hasGame = true; log.length = 0;
  menu.show('main'); ok('메뉴: 게임 중에는 RESUME 이 맨 위 (CONTINUE 없음)', ids()[0] === 'resume' && !ids().includes('continue'));
  click('resume'); ok('메뉴: RESUME → 닫고 이어서', !menu.open && log.includes('resume'));
  menu.show('main'); click('new'); click('skill4');
  ok('메뉴: 게임 중 난이도를 누르면 확인 창이 뜨고 아직 시작하지 않는다', menu.state === 'confirm' && !log.some((l) => l.startsWith('new')));
  ok('메뉴: 확인 창의 기본 선택은 NO', menu.layout().items[menu.cursor].id === 'no');
  menu.key('Enter'); ok('메뉴: NO → 난이도 화면으로 (게임은 그대로)', menu.state === 'skill' && !log.some((l) => l.startsWith('new')));
  click('skill4'); menu.key('KeyY'); ok('메뉴: Y → 새 게임 (악몽)', log.includes('new 5'));
  menu.show('main'); click('new'); click('skill1'); const yes = menu.layout().items.find((i) => i.id === 'yes'); menu.pointer(yes.rx0 + 2, yes.y + 2, true);
  ok('메뉴: YES 탭 → 새 게임', log.filter((l) => l.startsWith('new')).length === 2);
  hasGame = true; menu.show('main'); click('quit'); ok('메뉴: 게임 중 QUIT → 확인', menu.state === 'confirm'); menu.key('Escape'); ok('메뉴: Esc = 아니오 → 메인', menu.state === 'main');
  menu.show('options'); click('msg');
  ok('메뉴: 메시지 켜기/끄기', settings.messages === 0 && log.includes('settings'));
  menu.show('options'); menu.cursor = ids().indexOf('size'); menu.key('ArrowLeft'); menu.key('ArrowLeft');
  ok('메뉴: 화면 크기 슬라이더 (←←)', settings.screenSize === 8);
  menu.cursor = ids().indexOf('bright'); menu.key('ArrowRight'); ok('메뉴: 밝기 →', settings.gamma === 1);
  menu.show('cheats'); click('god'); click('kfa'); menu.cursor = ids().indexOf('power'); menu.key('ArrowRight'); click('give');
  ok('메뉴: CHEATS 항목이 치트 실행', log.includes('cheat god') && log.includes('cheat kfa') && log.includes('cheat power berserk'), `(${log.filter((l) => l.startsWith('cheat'))})`);
  menu.help('closed'); ok('도움말: 열림', menu.state === 'help' && menu.helpPage === 0);
  menu.key('Enter'); ok('도움말: 첫 키 → 2쪽', menu.state === 'help' && menu.helpPage === 1);
  log.length = 0; menu.key('Enter'); ok('도움말: 다음 키 → 닫고 이어서', !menu.open && log.includes('resume'));
}

console.log(out.join('\n'));

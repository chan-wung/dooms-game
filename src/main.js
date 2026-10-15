import { Wad } from './wad/wad.js';
import { loadLevel } from './wad/level.js';
import { saveWad, loadSavedWad } from './wad/store.js';
import { Automap } from './ui/automap.js';
import { Renderer, SCREEN_W, SCREEN_H } from './render/renderer.js';
import { Screen } from './render/screen.js';
import { loadPalette } from './gfx/palette.js';
import { TextureStore } from './gfx/textures.js';
import { SpriteStore } from './gfx/sprites.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { SoundSystem } from './audio/sound.js';
import { MusicPlayer, parseMus } from './audio/music.js';
import { Game, TICRATE } from './game/game.js';
import { MOUSE_SENS } from './game/player.js';
import { Input } from './app/input.js';
import { nextMapName } from './app/progress.js';
import { loadSettings, saveSettings as storeSettings, readSlot, writeSlot, listSlots, slotName, lastSlot, setLastSlot } from './app/storage.js';
import { saveGame, loadGame } from './game/savegame.js';

const $ = (id) => document.getElementById(id);
const $status = $('status'), $drop = $('drop'), $file = $('file');
const $bar = $('bar'), $stage = $('stage'), $help = $('help'), $hud = $('hud');
const $view = $('view'), $canvas = $('automap'), $mapSel = $('mapSel'), $mapOpts = $('mapOpts');
const $follow = $('optFollow'), $flat = $('optFlat'), $things = $('optThings'), $mode = $('btnMode');
const $sfx = $('optSfx'), $music = $('optMusic');
const $msg = $('msg'), $overlay = $('overlay'), $hurt = $('hurt');

const WAD_URL = '/wad/DOOM1.WAD';
const TIC = 1 / TICRATE;

// ---------- 설정 (브라우저에 기억) ----------
const settings = loadSettings({ sfx: 12, music: 8, sens: 5, skill: 3 });
const saveSettings = () => storeSettings(settings);

// ---------- 상태 ----------
let wad = null, level = null, game = null, mapName = null;
let appState = 'title';           // 'title' | 'play'
let showAutomap = false;
let acc = 0;
const automap = new Automap($canvas);
let renderer = null, screen = null, hud = null, menu = null, sound = null, music = null, touch = null;
const screenBuf = new Uint32Array(SCREEN_W * SCREEN_H);  // 화면 버퍼 (3D 뷰 + 상태바 + 메뉴)
const input = new Input();
const keys = input.keys;
window.keys = keys; // 콘솔 디버깅용
const mouseSens = () => MOUSE_SENS * (0.5 + settings.sens * 0.1);

// ---------- 캔버스 크기 (오토맵, DPR 반영) ----------
const resizeAutomap = () => {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor($canvas.clientWidth * dpr), h = Math.floor($canvas.clientHeight * dpr);
  if ($canvas.width !== w || $canvas.height !== h) { $canvas.width = w; $canvas.height = h; }
};

const setMode = (automapOn) => {
  showAutomap = automapOn;
  $view.hidden = automapOn;
  $canvas.hidden = !automapOn;
  $mapOpts.hidden = !automapOn;
  $mode.textContent = automapOn ? '3D 화면 (Tab)' : '오토맵 (Tab)';
  if (automapOn) { skipUnlockPause = true; document.exitPointerLock?.(); resizeAutomap(); automap.fit(); }
};

// ---------- 소리 / 음악 ----------
const songs = new Map(); // 곡 이름 → 파싱 결과 (한 번만 파싱)
let currentSong = null;

/** 지금 상황에 맞는 곡: 타이틀 / 결과 화면 / 에피소드 클리어 / 맵 */
const songFor = () => {
  if (appState === 'title' || !game) return 'D_INTRO';
  if (game.exited) return nextMapName(mapName, game.exited.secret) ? 'D_INTER' : 'D_VICTOR';
  return `D_${mapName}`;
};

const updateMusic = () => {
  if (!wad || !music) return;
  const name = songFor();
  if (!wad.has(name)) return;
  currentSong = name;
  if (!songs.has(name)) songs.set(name, parseMus(wad.getLump(name)));
  music.play(songs.get(name), name);
};

/** 브라우저는 사용자 입력 뒤에만 소리를 허용하므로, 첫 키/클릭에서 오디오를 연다 */
const startAudio = () => {
  if (!sound || sound.ctx) { sound?.ensure(); return; }
  if (sound.ensure()) { applySettings(); updateMusic(); }
};

const applySettings = () => {
  if (!sound) return;
  sound.setSfxVolume((settings.sfx / 15) * 0.9);
  sound.setMusicVolume((settings.music / 15) * 0.8);
  saveSettings();
};

// ---------- 저장 (맵을 시작할 때 슬롯 0 에 자동 저장: 그 맵을 이어받은 상태로 처음부터) ----------
let levelStart = null;   // 이 맵을 시작할 때의 이어받은 상태 (다시 하기용)
const writeAutoSave = (map, skill, state) =>
  writeSlot(0, { v: 1, kind: 'start', map, skill, state, name: `${map}  START`, savedAt: Date.now() });

/**
 * carry: 이전 맵에서 이어받은 상태(없으면 권총 시작)
 * saved: 맵 도중 저장 데이터 (있으면 그 상태로 이어서)
 */
const openMap = (name, carry = null, saved = null) => {
  try {
    const lvl = loadLevel(wad, name);
    const g = saved ? loadGame(lvl, saved.skill, saved.game) : new Game(lvl, settings.skill, 1, carry);
    level = lvl; game = g;
    levelStart = saved ? saved.levelStart : carry;
    if (!saved) writeAutoSave(name, settings.skill, game.player.exportState());
    game.onSound = (snd, src) => sound.play(snd, src);
    mapName = name;
    appState = 'play';
    automap.setLevel(level, game.player);
    window.level = level; window.game = game; window.player = game.player; // 콘솔 디버깅용
    $mapSel.value = name;
    $overlay.hidden = true;
    acc = 0;
    $status.textContent =
      `${name} — 난이도 ${settings.skill} · 정점 ${level.vertexes.length} · 선 ${level.linedefs.length} · 섹터 ${level.sectors.length} · ` +
      `things ${level.things.length} (표시 ${game.mobjs.length}) · segs ${level.segs.length} · 서브섹터 ${level.subsectors.length} · 노드 ${level.nodes.length}`;
    if (game.unknownThings.size) console.warn('아직 모르는 thing 종류:', Object.fromEntries(game.unknownThings));
    updateMusic();
  } catch (err) {
    $status.textContent = `${name} 로드 실패: ${err.message}`;
    console.error(err);
  }
};

// ---------- 메뉴 연결 ----------
const lockPointer = () => { if (!touch && document.pointerLockElement !== $view) $view.requestPointerLock?.(); };

const openMenu = () => {
  if (!menu || menu.open) return;
  input.releaseAll();
  setMode(false);
  menu.show('main');
  document.exitPointerLock?.();
};

const quitToTitle = () => {
  game = null; level = null; appState = 'title';
  document.exitPointerLock?.();
  $overlay.hidden = true; $msg.textContent = ''; $hurt.style.opacity = '0';
  menu.show('title');
  updateMusic();
};

const canSave = () => appState === 'play' && !!game && !game.player.dead && !game.exited;

/** 슬롯 n 에서 불러오기. 슬롯이 비었거나 맵을 못 열면 false */
const loadSlot = (n) => {
  const s = readSlot(n);
  if (!s || !wad.has(s.map)) return false;
  settings.skill = s.skill; saveSettings(); menu.close();
  if (s.kind === 'full') openMap(s.map, null, s); else openMap(s.map, s.state);
  lockPointer();
  return !!game;
};

/** 지금 상태를 슬롯 n 에 저장 */
const saveSlot = (n) => {
  if (!canSave()) return false;
  const data = { v: 2, kind: 'full', map: mapName, skill: game.skill, name: slotName(mapName), savedAt: Date.now(), levelStart, game: saveGame(game) };
  if (!writeSlot(n, data)) { game.say('SAVE FAILED'); return false; }
  setLastSlot(n);
  menu.close(); game.say('GAME SAVED.'); lockPointer();
  return true;
};

const quickSave = () => { if (!menu.open && canSave()) saveSlot(lastSlot()); };
const quickLoad = () => { if (readSlot(lastSlot())) loadSlot(lastSlot()); };

const startMenuActions = () => ({
  hasGame: () => appState === 'play' && !!game,
  canSave,
  slotNames: () => listSlots().map((s, n) => (s ? (n === 0 ? `AUTO  ${s.map}` : s.name) : null)),
  loadSlot,
  saveSlot,
  newGame: (skill) => { settings.skill = skill; saveSettings(); menu.close(); openMap('E1M1'); lockPointer(); },
  quitToTitle,
  settingsChanged: applySettings,
  play: (name) => sound.play(name),
});

// ---------- WAD 로딩 ----------
const startWad = (buf, source, persist = false) => {
  try {
    wad = new Wad(buf);
    const gfx = { palette: loadPalette(wad), textures: new TextureStore(wad), sprites: new SpriteStore(wad) };
    renderer = new Renderer(gfx, screenBuf);
    screen = new Screen($view, screenBuf);
    hud = new Hud(gfx, wad);
    sound = new SoundSystem(wad);
    music = new MusicPlayer(() => (sound.ensure() ? { ctx: sound.ctx, bus: sound.musicBus } : null));
    menu = new Menu(hud, startMenuActions(), settings);
    window.gfx = gfx; window.sound = sound; window.music = music; window.menu = menu; window.settings = settings;
  } catch (err) {
    wad = null;
    $status.textContent = `WAD 로딩 실패: ${err.message}`;
    console.error(err);
    return;
  }
  window.wad = wad;
  const maps = wad.getMapNames();
  if (!maps.length) { $status.textContent = `${source}: 맵이 없는 WAD입니다.`; return; }
  if (persist) saveWad(buf, source);   // 다음에 다시 고르지 않아도 되게 브라우저에 보관
  $drop.hidden = true;
  $bar.hidden = $stage.hidden = $help.hidden = false;
  $mapSel.replaceChildren(new Option('맵 선택…', ''), ...maps.map((m) => new Option(m, m)));
  setMode(false);
  appState = 'title';
  menu.show('title');
  $status.textContent = `${source} 로드 완료 — 아무 키나 눌러 시작하세요.`;
  updateMusic();
};

const fetchDefault = async () => {
  try {
    const res = await fetch(WAD_URL);
    const type = res.headers.get('content-type') || '';
    // Vite dev 서버는 없는 파일에 index.html(SPA 폴백)을 돌려주므로 확인 필요
    if (!res.ok || type.includes('text/html')) throw new Error('not found');
    startWad(await res.arrayBuffer(), WAD_URL);
  } catch {
    const saved = await loadSavedWad();
    if (saved) startWad(saved.buffer, `${saved.name} (이 브라우저에 저장됨)`);
    else $status.textContent = '게임 데이터(DOOM1.WAD)가 필요합니다. 아래에 파일을 끌어다 놓거나 선택하세요. (파일은 이 브라우저에만 저장됩니다)';
  }
};
const loadFile = async (f) => { if (f) startWad(await f.arrayBuffer(), f.name, true); };
$file.addEventListener('change', () => loadFile($file.files[0]));
$drop.addEventListener('dragover', (e) => { e.preventDefault(); $drop.classList.add('over'); });
$drop.addEventListener('dragleave', () => $drop.classList.remove('over'));
$drop.addEventListener('drop', (e) => { e.preventDefault(); $drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });

// ---------- UI 이벤트 ----------
$mapSel.addEventListener('change', () => {
  $mapSel.blur();
  if (!$mapSel.value) return;
  menu.close(); openMap($mapSel.value); lockPointer();
});
$mode.addEventListener('click', () => { $mode.blur(); if (appState === 'play') setMode(!showAutomap); });
$follow.addEventListener('change', () => { automap.follow = $follow.checked; });
$flat.addEventListener('change', () => { automap.showFlat = $flat.checked; });
$things.addEventListener('change', () => { automap.showThings = $things.checked; });
$sfx.addEventListener('change', () => { if (sound) sound.sfxOn = $sfx.checked; });
$music.addEventListener('change', () => { startAudio(); music?.setEnabled($music.checked); });
$('btnFit').addEventListener('click', () => {
  $follow.checked = automap.follow = false;
  automap.fit();
});

const toggle = ($el) => { $el.checked = !$el.checked; $el.dispatchEvent(new Event('change')); };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return; // 선택/체크 중엔 무시
  startAudio();
  if (e.code === 'F6' || e.code === 'F9') {        // 퀵세이브 / 퀵로드 (브라우저 기본 동작은 막는다)
    e.preventDefault();
    if (menu && !e.repeat) { if (e.code === 'F6') quickSave(); else quickLoad(); }
    return;
  }
  if (menu?.open) {                                // 메뉴가 열려 있으면 메뉴가 키를 받는다
    if (menu.key(e.code)) { e.preventDefault(); return; }
  }
  if (e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!wad || appState !== 'play') return;
  if (e.code === 'Escape' && !e.repeat) { openMenu(); return; }
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Tab') setMode(!showAutomap);
  if (e.code === 'KeyR') { restartMap(); }
  if (e.code === 'Enter' && game?.exited) nextMap();
  const digit = /^Digit([1-7])$/.exec(e.code);
  if (digit && !showAutomap) input.weaponKey = Number(digit[1]);
  if (e.code === 'KeyN' && game) { game.player.noclip = !game.player.noclip; game.say(game.player.noclip ? 'NOCLIP ON' : 'NOCLIP OFF'); }
  if (e.code === 'KeyK' && game) { Object.assign(game.player.keys, { blue: true, yellow: true, red: true }); game.say('ALL KEYS'); }
  if (showAutomap) {
    if (e.code === 'KeyF') toggle($follow);
    if (e.code === 'KeyT') toggle($things);
    if (e.code === 'Digit0') $('btnFit').click();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// 마우스: 화면 좌표(320×200)로 바꿔 메뉴에 전달 / 게임 중에는 포인터 잠금으로 시점
const toScreen = (e) => {
  const r = $view.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * SCREEN_W, ((e.clientY - r.top) / r.height) * SCREEN_H];
};
let skipUnlockPause = false;
$view.addEventListener('pointermove', (e) => { if (menu?.open) menu.pointer(...toScreen(e), false); });
$view.addEventListener('click', (e) => {
  startAudio();
  if (menu?.open) { menu.pointer(...toScreen(e), true); return; }
  if (appState === 'play') lockPointer();
});
$view.addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement === $view) input.mouseFire = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) input.mouseFire = false; });
$view.addEventListener('wheel', (e) => { e.preventDefault(); input.wheel += Math.sign(e.deltaY); }, { passive: false });
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === $view) input.mouseDX += e.movementX; });
// 포인터 잠금이 풀리면(Esc 등) 일시정지 메뉴를 연다
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === $view) return;
  if (skipUnlockPause) { skipUnlockPause = false; return; }
  if (appState === 'play' && menu && !menu.open && !showAutomap) openMenu();
});

// 오토맵: 팬 (드래그) / 줌 (휠)
let dragging = false;
$canvas.addEventListener('pointerdown', (e) => {
  dragging = true; $canvas.classList.add('drag'); $canvas.setPointerCapture(e.pointerId);
});
$canvas.addEventListener('pointerup', () => { dragging = false; $canvas.classList.remove('drag'); });
$canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dpr = $canvas.width / $canvas.clientWidth;
  automap.panBy(e.movementX * dpr, e.movementY * dpr);
  $follow.checked = automap.follow = false; // 직접 팬하면 따라가기 해제
});
$canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = $canvas.getBoundingClientRect(), dpr = $canvas.width / r.width;
  automap.zoomAt((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

$('btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $stage.requestFullscreen?.().catch(() => {});
});

// 터치 기기: 가상 조이스틱과 버튼
if (isTouchDevice()) {
  touch = new TouchControls($stage, {
    menu: () => { startAudio(); openMenu(); },
    map: () => { if (appState === 'play') setMode(!showAutomap); },
  });
  $stage.classList.add('is-touch');
  document.documentElement.classList.add('is-touch');
  // 첫 터치에서 전체화면 + 가로 고정 시도 (미지원/거부 시 무시)
  addEventListener('pointerdown', () => {
    if (document.fullscreenElement) return;
    $stage.requestFullscreen?.().then(() => window.screen.orientation?.lock?.('landscape')).catch(() => {});
  }, { once: true });
  input.touch = touch;
  window.touch = touch; // 콘솔 디버깅용
}

// 다시 하기: 죽었으면 권총 시작, 아니면 이 맵을 시작했을 때의 상태로
const restartMap = () => { openMap(mapName, game?.player.dead ? null : levelStart); lockPointer(); };
const nextMap = () => {
  const next = nextMapName(mapName, game.exited.secret);
  if (next && wad.has(next)) { openMap(next, game.player.exportState()); lockPointer(); }
};

// 모바일: 결과/사망 화면에서 탭으로 진행 (Enter/R 이 없으므로)
let endShownAt = 0;
$stage.addEventListener('pointerdown', () => {
  if (!touch || appState !== 'play' || !game || menu.open || !endShownAt || performance.now() - endShownAt < 800) return;
  if (game.exited) { if (nextMapName(mapName, game.exited.secret)) nextMap(); else restartMap(); }
  else if (game.player.dead) restartMap();
});

// ---------- 오버레이 (출구 / 사망 / 메시지) ----------
const mmss = (tics) => `${Math.floor(tics / TICRATE / 60)}:${String(Math.floor(tics / TICRATE) % 60).padStart(2, '0')}`;
const updateOverlay = () => {
  const p = game.player;
  $msg.textContent = game.message;
  // 화면 색 번쩍임: 피격 = 빨강, 아이템 획득 = 금색
  if (p.damageCount > 0 && !p.dead) { $hurt.style.background = '#c00'; $hurt.style.opacity = String(Math.min(0.55, p.damageCount * 0.012)); }
  else if (p.dead) { $hurt.style.background = '#800'; $hurt.style.opacity = '0.35'; }
  else if (game.pickupFlash > 0) { $hurt.style.background = '#fc4'; $hurt.style.opacity = String(game.pickupFlash * 0.05); }
  else $hurt.style.opacity = '0';
  if (menu.open) { $overlay.hidden = true; return; }
  if (game.exited) {
    const next = nextMapName(mapName, game.exited.secret);
    $overlay.hidden = false;
    $overlay.innerHTML =
      `<b>${mapName} 완료</b><br>시간 ${mmss(game.exited.time)}<br>킬 ${game.killsFound}/${game.killsTotal} · 아이템 ${game.itemsFound}/${game.itemsTotal} · 비밀 ${game.secretsFound}/${game.secretsTotal}<br><br>` +
      (next ? `<span>${touch ? '화면을 탭' : 'Enter'}: ${next} 로 이동</span>` : '<span>THE END — 에피소드 클리어!</span>') + `<br><span>${touch ? (next ? '' : '화면을 탭: 다시 하기') : 'R: 다시 하기'}</span>`;
  } else if (p.dead) {
    $overlay.hidden = false;
    $overlay.innerHTML = `<b>YOU DIED</b><br><br><span>${touch ? '화면을 탭' : 'R'}: 다시 시작</span>`;
  } else {
    $overlay.hidden = true;
  }
  if (game.exited || p.dead) { if (!endShownAt) endShownAt = performance.now(); } else endShownAt = 0;
};

// ---------- 루프 ----------
let last = performance.now(), fps = 0, hudTimer = 0;
const frame = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;
  if (touch) touch.show(!menu?.open);   // 메뉴가 열려 있으면 터치 오버레이가 화면 탭을 가로채지 않게 숨김

  if (wad) {
    if (appState === 'play' && game) {
      const p = game.player, paused = menu.open;
      sound.listener = { x: p.x, y: p.y, angle: p.angle };
      if (touch) input.mouseDX += touch.takeTurn(dt) * 1.4;              // 화면 드래그 = 마우스처럼
      if (input.mouseDX) { if (!p.dead && !game.exited && !paused) p.turnBy(-input.mouseDX * mouseSens()); input.mouseDX = 0; }

      // 로직은 35Hz 고정 tic, 화면은 매 프레임 (tic 사이는 위치 보간). 메뉴가 열려 있으면 정지
      if (paused) acc = 0; else acc += dt;
      while (acc >= TIC) { game.tick(input.buildCmd()); input.endTic(); acc -= TIC; }
      if (songFor() !== currentSong) updateMusic();                    // 결과 화면/승리 음악 전환

      if (showAutomap) {
        resizeAutomap();
        automap.tick();
        automap.draw();
      } else {
        const view = p.view(acc / TIC);
        renderer.render(game.level, view, game.mobjs);
        hud.drawWeapon(screenBuf, game, view);
        hud.drawStatusBar(screenBuf, game);
        if (menu.open) menu.draw(screenBuf, now);
        screen.present();
      }
      updateOverlay();

      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.25;
        $hud.textContent =
          `FPS ${fps.toFixed(0)} · HP ${p.health} · 방어구 ${p.armor} · ` +
          `탄약 총알 ${p.ammo.clip} 샷 ${p.ammo.shell} 로켓 ${p.ammo.rocket} 셀 ${p.ammo.cell} · ` +
          `열쇠 ${['blue', 'yellow', 'red'].filter((k) => p.keys[k]).join('/') || '-'} · ` +
          `아이템 ${game.itemsFound}/${game.itemsTotal} · 비밀 ${game.secretsFound}/${game.secretsTotal} · ` +
          `위치 (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) 바닥 ${p.sector.floorHeight}` +
          `${p.noclip ? ' · NOCLIP' : ''}${p.powers.invuln > 0 ? ' · 무적' : ''}${p.powers.radsuit > 0 ? ' · 방사능복' : ''}`;
      }
    } else {
      // 타이틀 화면
      menu.draw(screenBuf, now);
      screen.present();
    }
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

fetchDefault();

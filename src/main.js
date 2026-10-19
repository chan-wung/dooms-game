import { Wad } from './wad/wad.js';
import { t, setLang, getLang, LANGS } from './app/i18n.js';
import { TextLayer, loadFont } from './ui/font.js';
import { loadLevel } from './wad/level.js';
import { saveWad, loadSavedWad, clearSavedWad } from './wad/store.js';
import { Automap } from './ui/automap.js';
import { Renderer, SCREEN_W, SCREEN_H } from './render/renderer.js';
import { Screen } from './render/screen.js';
import { Wipe } from './render/wipe.js';
import { loadPalette, tintPalette, GAMMA_LEVELS } from './gfx/palette.js';
import { TextureStore } from './gfx/textures.js';
import { SpriteStore } from './gfx/sprites.js';
import { Hud } from './ui/hud.js';
import { Intermission, Finale } from './ui/intermission.js';
import { Menu } from './ui/menu.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { SoundSystem } from './audio/sound.js';
import { MusicPlayer, parseMus } from './audio/music.js';
import { Game, TICRATE } from './game/game.js';
import { MOUSE_SENS } from './game/player.js';
import { Input } from './app/input.js';
import { nextMapName, storyAfter, mapSong } from './app/progress.js';
import { AI } from './game/states.js';
import { loadSettings, saveSettings as storeSettings, readSlot, writeSlot, listSlots, slotName, lastSlot, setLastSlot } from './app/storage.js';
import { saveGame, loadGame } from './game/savegame.js';
import { CheatTyper, cheatChar, toggleGod, toggleNoclip, giveKfa, giveFa, togglePower, giveChainsaw, showPosition } from './game/cheats.js';

const $ = (id) => document.getElementById(id);
const $status = $('status'), $drop = $('drop'), $file = $('file');
const $bar = $('bar'), $stage = $('stage'), $help = $('help'), $hud = $('hud');
const $view = $('view'), $canvas = $('automap'), $mapSel = $('mapSel'), $mapOpts = $('mapOpts');
const $follow = $('optFollow'), $flat = $('optFlat'), $things = $('optThings'), $mode = $('btnMode');
const $sfx = $('optSfx'), $music = $('optMusic');
const $msg = $('msg'), $overlay = $('overlay');
const $lang = $('langSel');

// 상태 줄: 언어를 바꿔도 같은 문구가 다시 번역되도록 키와 변수를 기억한다
let statusKey = null, statusVars = null;
const setStatus = (key, vars) => { statusKey = key; statusVars = vars; $status.textContent = t(key, vars); };

const WAD_URL = '/wad/DOOM1.WAD';
const TIC = 1 / TICRATE;

// ---------- 설정 (브라우저에 기억) ----------
const settings = loadSettings({ sfx: 12, music: 8, sens: 5, skill: 3, messages: 1, screenSize: 10, gamma: 0, lang: 'ko', muted: 0, autoLandscape: 0, musicOn: 0, sfxOn: 0 });   // 음악·효과음은 기본으로 꺼 둔다 (위쪽 체크로 켬)
setLang(LANGS.includes(settings.lang) ? settings.lang : 'ko');
loadFont();                           // 한글 글꼴 (불러오는 동안은 시스템 글꼴)
$music.checked = !!settings.musicOn;
$sfx.checked = !!settings.sfxOn;
const saveSettings = () => storeSettings(settings);

// ---------- 상태 ----------
let wad = null, level = null, game = null, mapName = null;
let appState = 'title';           // 'title' | 'play' | 'intermission' (통계 화면) | 'finale' (에피소드 엔딩)
let showAutomap = false;
let acc = 0;
const automap = new Automap($canvas);
window.automap = automap; // 콘솔 디버깅용
let gfxRef = null, renderer = null, screen = null, textLayer = null, hud = null, menu = null, sound = null, music = null, touch = null, inter = null, finale = null;
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
  $mode.textContent = t(automapOn ? 'ui.view3d' : 'ui.automap');
  touch?.setAutomap(automapOn);
  if (automapOn) { skipUnlockPause = true; document.exitPointerLock?.(); resizeAutomap(); }
};

// ---------- 소리 / 음악 ----------
const songs = new Map(); // 곡 이름 → 파싱 결과 (한 번만 파싱)
let currentSong = null;

/** 지금 상황에 맞는 곡: 타이틀 / 결과 화면 / 에피소드 클리어 / 맵 */
const songFor = () => {
  const first = (...names) => names.find((n) => wad.has(n)) ?? names[0];   // 둠1 / 둠2 곡 이름이 다르다
  if (appState === 'intermission') return first('D_INTER', 'D_DM2INT');
  if (appState === 'finale') return finale.song ?? 'D_VICTOR';
  if (appState === 'title' || !game) return first('D_INTRO', 'D_DM2TTL');
  return mapSong(mapName);
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

/** 화면 쪽 옵션: 뷰 크기(화면 크기)와 밝기(감마) */
const applyVideo = () => {
  if (!renderer) return;
  renderer.setViewSize(settings.screenSize);
  gfxRef.palette.setGamma(settings.gamma);
};

const applySettings = () => {
  applyVideo();
  if (sound) {
    sound.setSfxVolume(settings.muted ? 0 : (settings.sfx / 15) * 0.9);
    sound.setMusicVolume(settings.muted ? 0 : (settings.music / 15) * 0.8);
  }
  saveSettings();
};

// ---------- 화면 녹는 전환 (맵 시작·점수 화면·타이틀로 갈 때) ----------
const wipe = new Wipe();
let wiping = false, wipeAcc = 0;
/** 상태가 바뀌기 직전에 부른다: 지금 화면을 옛 화면으로 잡아 둔다 (오토맵은 캔버스라 제외) */
const startWipe = () => {
  if (showAutomap || !screen) return;
  wipe.start(screenBuf);
  wiping = true; wipeAcc = 0;
};
/** 새 화면이 그려진 뒤 호출: 전환 중이면 옛 화면을 덧그려 녹이고 화면에 올린다 */
const present = (dt) => {
  if (wiping) {
    wipeAcc += dt;
    while (wipeAcc >= TIC) { wipe.tick(); wipeAcc -= TIC; }
    wipe.draw(screenBuf);
    if (wipe.done) wiping = false;
  }
  screen.present();
  const texts = hud.takeTexts();
  textLayer.render(wiping ? [] : texts);     // 한글 문구는 녹는 전환이 끝난 뒤에 겹쳐 그린다
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
    g.registered = wad.has('PLSGA0');   // 플라즈마·BFG 그림이 있는 WAD (정식판) 에서만 치트로 준다
    g.commercial = wad.has('SHT2A0');   // 슈퍼 샷건 그림이 있는 WAD (둠2)
    startWipe();
    level = lvl; game = g;
    levelStart = saved ? saved.levelStart : carry;
    if (!saved) writeAutoSave(name, settings.skill, game.player.exportState());
    game.onSound = (snd, src) => sound.play(snd, src);
    mapName = name;
    appState = 'play';
    automap.setLevel(level, game.player);
    $follow.checked = true;
    window.level = level; window.game = game; window.player = game.player; // 콘솔 디버깅용
    $mapSel.value = name;
    $overlay.hidden = true;
    acc = 0;
    setStatus('ui.mapInfo', {
      name, skill: settings.skill, vertexes: level.vertexes.length, lines: level.linedefs.length, sectors: level.sectors.length,
      things: level.things.length, shown: game.mobjs.length, segs: level.segs.length, subsectors: level.subsectors.length, nodes: level.nodes.length,
    });
    if (game.unknownThings.size) console.warn('아직 모르는 thing 종류:', Object.fromEntries(game.unknownThings));
    updateMusic();
    touch?.showHelpOnce();
  } catch (err) {
    setStatus('ui.wadLoadFail', { name, err: err.message });
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
  startWipe();
  game = null; level = null; appState = 'title';
  document.exitPointerLock?.();
  $overlay.hidden = true; $msg.textContent = '';
  menu.show('title');
  updateMusic();
};

const canSave = () => appState === 'play' && !!game && !game.player.dead && !game.exited;

// ---------- 치트 (키보드로 치는 것과 옵션 메뉴의 CHEATS 가 같은 함수) ----------
const typer = new CheatTyper();
let automapMode = 0;   // IDDT: 0 = 본 선만, 1 = 모든 선, 2 = 모든 선 + 물체

const setAutomapMode = (mode) => {
  automapMode = mode;
  $flat.checked = automap.cheat = mode >= 1;
  $things.checked = automap.showThings = mode >= 2;
};

/** 치트 실행. 메시지는 메뉴에서 눌러도 보이게 항상 띄운다 (say 의 두 번째 인자) */
const runCheat = (name, arg) => {
  if (!game || appState !== 'play') return false;
  switch (name) {
    case 'god': toggleGod(game); break;
    case 'noclip': toggleNoclip(game); break;
    case 'kfa': giveKfa(game); break;
    case 'fa': giveFa(game); break;
    case 'power': togglePower(game, arg); break;
    case 'chainsaw': giveChainsaw(game); break;
    case 'pos': showPosition(game); break;
    case 'beholdHelp': game.say(t('cheat.beholdHelp'), true); break;
    case 'map':
      setAutomapMode((automapMode + 1) % 3);
      game.say(t(`cheat.automap${automapMode}`), true);
      break;
    case 'warp':
      if (!wad.has(arg)) arg = arg.replace(/^E(\d)M(\d)$/, 'MAP$1$2');   // 둠2: IDCLEV07 → MAP07
      if (wad.has(arg)) { menu.close(); openMap(arg, game.player.exportState()); game.say(t('cheat.warp'), true); lockPointer(); }
      break;
    default: return false;
  }
  return true;
};
const cheatInfo = () => ({ god: !!game?.player.god, noclip: !!game?.player.noclip, automap: automapMode });

/** 슬롯 n 에서 불러오기. 슬롯이 비었거나 맵을 못 열면 false */
const loadSlot = (n) => {
  const s = readSlot(n);
  if (!s || !wad.has(s.map)) return false;
  settings.skill = s.skill; saveSettings(); menu.close();
  if (s.kind === 'full') openMap(s.map, null, s); else openMap(s.map, s.state);
  lockPointer();
  return !!game;
};

const fullSave = (name) => ({ v: 2, kind: 'full', map: mapName, skill: game.skill, name, savedAt: Date.now(), levelStart, game: saveGame(game) });

/** 지금 상태를 슬롯 n 에 저장 */
const saveSlot = (n) => {
  if (!canSave()) return false;
  if (!writeSlot(n, fullSave(slotName(mapName)))) { game.say(t('game.saveFailed'), true); return false; }
  setLastSlot(n);
  menu.close(); game.say(t('game.saved'), true); lockPointer();
  return true;
};

/** 앱을 떠날 때(전화·다른 앱·탭 닫힘) 지금 상태를 AUTO 슬롯에 남긴다: 브라우저가 페이지를 정리해도 CONTINUE 로 이어서 할 수 있다 */
const autoSaveOnLeave = () => {
  if (canSave()) writeSlot(0, fullSave(`${mapName}  AUTO`));
};

// ---------- 원작 F키 단축키 ----------
/** 메뉴가 닫혀 있으면 열고 fn 실행 (게임 중이면 일시정지 메뉴가 열린다) */
const withMenu = (fn) => { if (!menu) return; if (!menu.open) openMenu(); fn(); };
const gammaText = () => (settings.gamma ? t('game.gamma', { n: settings.gamma }) : t('game.gammaOff'));
const refuse = () => sound?.play('OOF');

const toggleMessages = () => {
  settings.messages = settings.messages ? 0 : 1;
  applySettings();
  game?.say(t(settings.messages ? 'game.messagesOn' : 'game.messagesOff'), true);
};
const cycleGamma = () => {
  settings.gamma = (settings.gamma + 1) % GAMMA_LEVELS;
  applySettings();
  game?.say(gammaText(), true);
};
const changeScreenSize = (d) => {
  if (menu?.open || !renderer || showAutomap) return;
  settings.screenSize = Math.max(3, Math.min(11, settings.screenSize + d));
  applySettings();
};

const FUNCTION_KEYS = {
  F1: () => {
    if (!menu) return;
    const from = !menu.open ? 'closed' : menu.state === 'title' ? 'main' : menu.state;
    if (!menu.open) openMenu();
    menu.help(from);
  },
  F2: () => (canSave() ? withMenu(() => menu.show('save')) : refuse()),
  F3: () => withMenu(() => menu.show('load')),
  F4: () => withMenu(() => menu.show('sound')),
  F7: () => (appState === 'play' && game
    ? withMenu(() => menu.ask(t('ask.endGame'), quitToTitle, 'close')) : refuse()),
  F8: () => (appState === 'play' ? toggleMessages() : refuse()),
  F10: () => (appState === 'play' && game
    ? withMenu(() => menu.ask(t('ask.quitTitle'), quitToTitle, 'close')) : refuse()),
  F11: cycleGamma,
};

const quickSave = () => { if (!menu.open && canSave()) saveSlot(lastSlot()); };
const quickLoad = () => { if (readSlot(lastSlot())) loadSlot(lastSlot()); };

const startMenuActions = () => ({
  maps: () => wad.getMapNames(),
  currentMap: () => (appState === 'play' ? mapName : null),
  warp: (name) => { menu.close(); openMap(name); lockPointer(); },
  hasGame: () => appState === 'play' && !!game,
  hasAuto: () => !!readSlot(0),
  resume: () => lockPointer(),
  cheat: runCheat,
  cheatInfo,
  canSave,
  slotNames: () => listSlots().map((s, n) => (s ? (n === 0 ? `AUTO  ${s.map}` : s.name) : null)),
  loadSlot,
  saveSlot,
  episodes: () => [1, 2, 3, 4].filter((n) => wad.has(`E${n}M1`)),
  newGame: (skill, episode) => {
    settings.skill = skill; saveSettings(); menu.close();
    openMap(episode ? `E${episode}M1` : wad.getMapNames()[0]); lockPointer();
  },
  quitToTitle,
  changeWad,
  settingsChanged: applySettings,
  play: (name) => sound.play(name),
});

// ---------- WAD 로딩 ----------
const startWad = (buf, source, persist = false) => {
  try {
    wad = new Wad(buf);
    const gfx = { palette: loadPalette(wad), textures: new TextureStore(wad), sprites: new SpriteStore(wad) };
    gfxRef = gfx;
    renderer = new Renderer(gfx, screenBuf);
    screen = new Screen($view, screenBuf);
    textLayer ??= new TextLayer($view);
    hud = new Hud(gfx, wad);
    sound = new SoundSystem(wad);
    sound.sfxOn = !!settings.sfxOn;
    music = new MusicPlayer(() => (sound.ensure() ? { ctx: sound.ctx, bus: sound.musicBus } : null));
    music.setEnabled(!!settings.musicOn);
    menu = new Menu(hud, startMenuActions(), settings);
    inter = new Intermission(hud, (name) => sound.play(name));
    finale = new Finale(hud, (name) => sound.play(name), (sprite) => AI[sprite]);
    applyVideo();
    window.gfx = gfx; window.sound = sound; window.music = music; window.menu = menu; window.settings = settings;
  } catch (err) {
    wad = null;
    setStatus('ui.wadLoadFailShort', { err: err.message });
    console.error(err);
    return;
  }
  window.wad = wad;
  const maps = wad.getMapNames();
  if (!maps.length) { setStatus('ui.wadNoMaps', { source }); return; }
  if (persist) saveWad(buf, source);   // 다음에 다시 고르지 않아도 되게 브라우저에 보관
  $drop.hidden = true; $("wadList").hidden = true;
  $bar.hidden = $stage.hidden = $help.hidden = false;
  $mapSel.replaceChildren(new Option('맵 선택…', ''), ...maps.map((m) => new Option(m, m)));
  setMode(false);
  appState = 'title';
  menu.show('title');
  setStatus('ui.wadLoaded', { source });
  updateMusic();
};

const WAD_PICK_KEY = 'doomjs.wad';        // 마지막으로 고른 public/wad 파일 이름
const WAD_ASK_KEY = 'doomjs.wadAsk';      // "WAD 바꾸기" 직후 한 번은 무조건 고르게 한다
const store = (fn) => { try { return fn(); } catch { return null; } };

/** public/wad 의 WAD 목록 (개발 서버만 제공, 없으면 기본 DOOM1.WAD 만 시도) */
const listServerWads = async () => {
  try {
    const res = await fetch('/wad/index.json');
    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
      const names = await res.json();
      if (Array.isArray(names)) return names;
    }
  } catch { /* 목록 없음 */ }
  return [WAD_URL.split('/').pop()];
};

const loadServerWad = async (name) => {
  const url = `/wad/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  const type = res.headers.get('content-type') || '';
  // Vite dev 서버는 없는 파일에 index.html(SPA 폴백)을 돌려주므로 확인 필요
  if (!res.ok || type.includes('text/html')) throw new Error('not found');
  store(() => localStorage.setItem(WAD_PICK_KEY, name));
  startWad(await res.arrayBuffer(), url);
};

const showWadPicker = (names) => {
  const $list = $('wadList');
  $list.replaceChildren(...names.map((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => { $list.hidden = true; setStatus('ui.wadLoading', { name }); loadServerWad(name).catch(() => { $list.hidden = false; setStatus('ui.wadFailed', { name }); }); });
    return b;
  }));
  $list.hidden = false;
  setStatus('ui.wadPick');
};

const fetchDefault = async () => {
  const names = await listServerWads();
  const ask = store(() => sessionStorage.getItem(WAD_ASK_KEY));
  store(() => sessionStorage.removeItem(WAD_ASK_KEY));
  const last = store(() => localStorage.getItem(WAD_PICK_KEY));
  if (!ask) {
    // 마지막으로 고른 파일 → 하나뿐이면 그 파일 → (없으면) 브라우저에 저장된 WAD
    const auto = names.includes(last) ? last : (names.length === 1 ? names[0] : null);
    if (auto) { try { await loadServerWad(auto); return; } catch { /* 아래로 */ } }
    if (!auto) {
      const saved = await loadSavedWad();
      if (saved) { startWad(saved.buffer, t('ui.wadSaved', { name: saved.name })); return; }
    }
  }
  const available = [];
  for (const n of names) { try { const r = await fetch(`/wad/${encodeURIComponent(n)}`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) available.push(n); } catch { /* 건너뜀 */ } }
  if (available.length) { showWadPicker(available); return; }
  const saved = await loadSavedWad();
  if (saved && !ask) startWad(saved.buffer, t('ui.wadSaved', { name: saved.name }));
  else setStatus('ui.wadNeeded');
};
/** 저장해 둔 WAD 를 지우고 새로 시작한다 (파일 고르는 화면으로 돌아간다). 엔진 상태를 통째로 바꾸므로 새로고침이 가장 안전하다 */
async function changeWad() {
  await clearSavedWad();
  store(() => localStorage.removeItem(WAD_PICK_KEY));
  store(() => sessionStorage.setItem(WAD_ASK_KEY, '1'));
  window.location.reload();
}
const loadFile = async (f) => { if (f) startWad(await f.arrayBuffer(), f.name, true); };
$file.addEventListener('change', () => loadFile($file.files[0]));
$drop.addEventListener('dragover', (e) => { e.preventDefault(); $drop.classList.add('over'); });
$drop.addEventListener('dragleave', () => $drop.classList.remove('over'));
$drop.addEventListener('drop', (e) => { e.preventDefault(); $drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });

// ---------- 언어 ----------
/** 페이지의 data-i18n(글자) · data-i18n-html(서식 있는 글) 요소와 동적 문구를 현재 언어로 */
const applyDomLang = () => {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  $mode.textContent = t(showAutomap ? 'ui.view3d' : 'ui.automap');
  if (statusKey) $status.textContent = t(statusKey, statusVars);
  $lang.value = getLang();
  touch?.relabel();
};
const changeLang = (lang) => {
  setLang(lang);
  settings.lang = getLang();
  saveSettings();
  applyDomLang();
  if (menu?.open) menu.show(menu.state, menu.cursor);     // 열려 있는 메뉴도 새 언어로 다시 그린다
};
$lang.addEventListener('change', () => { $lang.blur(); changeLang($lang.value); });
applyDomLang();

// ---------- UI 이벤트 ----------
$mapSel.addEventListener('change', () => {
  $mapSel.blur();
  if (!$mapSel.value) return;
  menu.close(); openMap($mapSel.value); lockPointer();
});
$mode.addEventListener('click', () => { $mode.blur(); if (appState === 'play') setMode(!showAutomap); });
$follow.addEventListener('change', () => { automap.follow = $follow.checked; });
$flat.addEventListener('change', () => { automap.cheat = $flat.checked; });
$things.addEventListener('change', () => { automap.showThings = $things.checked; });
$sfx.addEventListener('change', () => {
  settings.sfxOn = $sfx.checked ? 1 : 0; saveSettings();
  if (sound) sound.sfxOn = $sfx.checked;
});
$music.addEventListener('change', () => {
  settings.musicOn = $music.checked ? 1 : 0; saveSettings();
  startAudio(); music?.setEnabled($music.checked);
});
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
  if (FUNCTION_KEYS[e.code] && wad && appState !== 'intermission' && appState !== 'finale') {   // 원작 F키 단축키
    e.preventDefault();
    if (!e.repeat) FUNCTION_KEYS[e.code]();
    return;
  }
  if (menu?.open) {                                // 메뉴가 열려 있으면 메뉴가 키를 받는다
    if (menu.key(e.code)) { e.preventDefault(); return; }
  }
  if (e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (wad && (appState === 'intermission' || appState === 'finale')) {       // 결과/엔딩 화면: 키로 진행
    if (!e.repeat && ['Enter', 'Space', 'KeyE', 'ControlLeft', 'ControlRight', 'KeyF'].includes(e.code)) pressScreen();
    else if (e.code === 'KeyR' && appState === 'intermission') restartMap();
    return;
  }
  if (!wad || appState !== 'play') return;
  if (e.code === 'Escape' && !e.repeat) { openMenu(); return; }
  if (e.code === 'Pause' && !e.repeat) { openMenu(); return; }

  // 치트 코드(IDDQD …)를 치는 중에는 그 글자들이 다른 단축키(R = 다시 시작 등)로 먹히지 않게 한다
  const ch = cheatChar(e.code);
  if (ch) {
    if (e.repeat) { if (typer.active) return; }
    else {
      const hit = typer.feed(ch, performance.now());
      if (hit) runCheat(hit.name, hit.arg);
      if (hit || typer.active) return;
    }
  }

  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Tab') setMode(!showAutomap);
  if (e.code === 'KeyR') { restartMap(); }
  const digit = /^Digit([1-7])$/.exec(e.code);
  if (digit && !showAutomap) input.weaponKey = Number(digit[1]);
  if (e.code === 'Minus' || e.code === 'Equal') changeScreenSize(e.code === 'Equal' ? 1 : -1);
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
  if (appState === 'intermission' || appState === 'finale') { pressScreen(); return; }
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

// 탭을 떠나거나 앱을 전환하면 일시정지 메뉴 (돌아와 보니 죽어 있는 일이 없게)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  autoSaveOnLeave();                                  // 브라우저가 페이지를 정리해도 CONTINUE 로 이어갈 수 있게
  if (appState === 'play' && menu && !menu.open) openMenu();
});
addEventListener('pagehide', autoSaveOnLeave);

// 오토맵: 한 손가락/마우스 드래그 = 이동, 두 손가락 = 확대·축소(핀치), 마우스 휠 = 줌
const mapPointers = new Map();   // pointerId → 마지막 위치
let pinchDist = 0;
$canvas.addEventListener('pointerdown', (e) => {
  mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  $canvas.classList.add('drag'); $canvas.setPointerCapture(e.pointerId);
  const [a, b] = [...mapPointers.values()];
  pinchDist = mapPointers.size === 2 ? Math.hypot(a.x - b.x, a.y - b.y) : 0;   // 두 번째 손가락이 닿는 순간의 간격이 기준
});
const endMapPointer = (e) => {
  mapPointers.delete(e.pointerId); pinchDist = 0;
  if (!mapPointers.size) $canvas.classList.remove('drag');
};
$canvas.addEventListener('pointerup', endMapPointer);
$canvas.addEventListener('pointercancel', endMapPointer);
$canvas.addEventListener('pointermove', (e) => {
  const prev = mapPointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  mapPointers.set(e.pointerId, cur);
  const r = $canvas.getBoundingClientRect(), dpr = $canvas.width / r.width;
  if (mapPointers.size === 1) automap.panBy((cur.x - prev.x) * dpr, (cur.y - prev.y) * dpr);
  else if (mapPointers.size === 2) {
    const [a, b] = [...mapPointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist && d) automap.zoomAt(((a.x + b.x) / 2 - r.left) * dpr, ((a.y + b.y) / 2 - r.top) * dpr, d / pinchDist);
    pinchDist = d;
  } else return;
  $follow.checked = automap.follow = false; // 직접 움직이면 따라가기 해제
});
$canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = $canvas.getBoundingClientRect(), dpr = $canvas.width / r.width;
  automap.zoomAt((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

$('btnWad').addEventListener('click', () => {
  $('btnWad').blur();
  if (appState === 'play' && game) withMenu(() => menu.ask(t('ask.changeWad'), changeWad, 'close'));
  else changeWad();
});

$('btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $stage.requestFullscreen?.().catch(() => {});
});

/** 전체화면으로 만들고 가로로 고정 (브라우저는 전체화면일 때만 화면 방향 고정을 허용한다. iOS 는 둘 다 안 되므로 직접 돌려야 한다) */
const goLandscape = async () => {
  try { if (!document.fullscreenElement) await $stage.requestFullscreen?.(); } catch { /* 거부됨 */ }
  try { await window.screen.orientation?.lock?.('landscape'); } catch { /* 미지원 */ }
};
const portraitQuery = window.matchMedia('(orientation: portrait)');

// 터치 기기: 가상 조이스틱과 버튼
if (isTouchDevice()) {
  touch = new TouchControls($stage, {
    menu: () => { startAudio(); openMenu(); },
    map: () => { if (appState === 'play') setMode(!showAutomap); },
    follow: () => toggle($follow),
    fit: () => $('btnFit').click(),
    fullscreen: goLandscape,
    getOpts: () => ({ muted: !!settings.muted, autoLandscape: !!settings.autoLandscape }),
    setOpt: (key, value) => { settings[key] = value ? 1 : 0; if (key === 'muted') startAudio(); applySettings(); },
    toggleLang: () => changeLang(getLang() === 'ko' ? 'en' : 'ko'),
    onHelpClosed: () => { startAudio(); if (settings.autoLandscape) goLandscape(); },
  });
  $stage.classList.add('is-touch');
  document.documentElement.classList.add('is-touch');
  // 옵션을 켠 경우에만 첫 터치에서 전체화면 + 가로 고정 시도 (미지원/거부 시 무시)
  addEventListener('pointerdown', () => { if (settings.autoLandscape) goLandscape(); }, { once: true });
  $('btnLandscape').addEventListener('click', goLandscape);
  input.touch = touch;
  window.touch = touch; // 콘솔 디버깅용
}

// 다시 하기: 죽었으면 권총 시작, 아니면 이 맵을 시작했을 때의 상태로
const restartMap = () => { openMap(mapName, game?.player.dead ? null : levelStart); lockPointer(); };

/** 출구를 밟았다: 에피소드 끝이면 엔딩, 아니면 점수 화면 */
const beginIntermission = () => {
  startWipe();
  const ex = game.exited, next = nextMapName(mapName, ex.secret);
  input.releaseAll(); setMode(false);
  document.exitPointerLock?.();
  $overlay.hidden = true; $msg.textContent = '';
  acc = 0;
  // 원작: 둠1 에피소드 마지막 맵은 점수 화면 없이 바로 엔딩 (둠2 는 MAP30 도 점수 화면 다음에 이야기 화면)
  if (!next && !/^MAP/.test(mapName)) { finale.start(Number(/^E(\d)/.exec(mapName)?.[1] ?? 1) - 1); appState = 'finale'; }
  else {
    inter.start({
      map: mapName, next, secretExit: ex.secret, time: ex.time,
      kills: game.killsFound, killsTotal: game.killsTotal, items: game.itemsFound, itemsTotal: game.itemsTotal,
      secrets: game.secretsFound, secretsTotal: game.secretsTotal,
    });
    appState = 'intermission';
  }
  updateMusic();
};

const nextMap = () => {
  const next = nextMapName(mapName, game.exited.secret);
  if (next && wad.has(next)) { openMap(next, game.player.exportState()); lockPointer(); }
  else quitToTitle();
};

/** 점수 화면·엔딩이 끝났다: 둠2 는 이야기 화면(C1~C6)을 거쳐 다음 맵으로, 엔딩이 끝나면 타이틀로 */
const afterScreen = () => {
  if (appState === 'intermission') {
    const story = storyAfter(mapName, game.exited.secret);
    if (story) { startWipe(); finale.startStory(story); appState = 'finale'; updateMusic(); return; }
    nextMap();
    return;
  }
  if (finale.story && nextMapName(mapName, game?.exited?.secret)) nextMap(); else quitToTitle();
};

/** 점수/엔딩 화면에서 키·탭: 진행 */
const pressScreen = () => { if (appState === 'intermission') inter.press(); else if (appState === 'finale') finale.press(); };

// 모바일: 사망 화면에서 탭으로 다시 시작 (R 키가 없으므로)
let endShownAt = 0;
$stage.addEventListener('pointerdown', () => {
  if (!touch) return;
  if (appState === 'intermission' || appState === 'finale') { pressScreen(); return; }
  if (appState !== 'play' || !game || menu.open || !endShownAt || performance.now() - endShownAt < 800) return;
  if (game.player.dead) restartMap();
});

// ---------- 오버레이 (사망 / 메시지) ----------
const updateOverlay = () => {
  const p = game.player;
  $msg.textContent = settings.messages || game.messageForce ? game.message : '';
  if (menu.open) { $overlay.hidden = true; return; }
  if (p.dead) {
    $overlay.hidden = false;
    $overlay.innerHTML = `<b>${t('ui.died')}</b><br><br><span>${t(touch ? 'ui.restartTouch' : 'ui.restartKeys')}: ${t('ui.restart')}</span>`;
    if (!endShownAt) endShownAt = performance.now();
  } else {
    $overlay.hidden = true;
    endShownAt = 0;
  }
};

// ---------- 화면 색조 (피격 빨강 · 아이템 금색 · 방사능복 초록: 원작 PLAYPAL 팔레트 교체) ----------
let tint = 0;
const setTint = (n) => { if (n === tint) return; tint = n; renderer.setPalette(n); hud.setPalette(n); };

// ---------- 루프 ----------
let last = performance.now(), fps = 0, hudTimer = 0;
const frame = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;
  if (touch) touch.show(appState === 'play' && !menu?.open);   // 메뉴·결과 화면에서는 터치 오버레이가 화면 탭을 가로채지 않게 숨김

  if (wad) {
    if (appState === 'play' && game) {
      const p = game.player, paused = wiping || menu.open || !!touch?.helpOpen || (!!touch && portraitQuery.matches);   // 세로로 들고 있으면(가로 안내 중) 멈춤
      sound.listener = { x: p.x, y: p.y, angle: p.angle };
      if (touch) input.mouseDX += touch.takeTurn(dt) * 1.4;              // 화면 드래그 = 마우스처럼
      if (input.mouseDX) { if (!p.dead && !game.exited && !paused) p.turnBy(-input.mouseDX * mouseSens()); input.mouseDX = 0; }

      // 로직은 35Hz 고정 tic, 화면은 매 프레임 (tic 사이는 위치 보간). 메뉴가 열려 있으면 정지
      if (paused) acc = 0; else acc += dt;
      while (acc >= TIC) { game.tick(input.buildCmd()); input.endTic(); acc -= TIC; }
      if (game.exited) { beginIntermission(); requestAnimationFrame(frame); return; }
      if (p.respawn) { restartMap(); requestAnimationFrame(frame); return; }          // 죽은 뒤 USE

      if (showAutomap) {
        resizeAutomap();
        automap.tick();
        automap.draw();
        textLayer.render([]);
      } else {
        const view = p.view(acc / TIC);
        setTint(tintPalette(p));
        gfxRef.textures.animate(game.time);
        renderer.render(game.level, view, game.mobjs);
        hud.drawBorder(screenBuf, renderer.window);
        hud.drawWeapon(screenBuf, game, view, renderer.window);
        if (renderer.window.blocks < 11) hud.drawStatusBar(screenBuf, game);
        if (menu.open) menu.draw(screenBuf, now);
        present(dt);
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
    } else if (appState === 'intermission' || appState === 'finale') {
      const screenObj = appState === 'intermission' ? inter : finale;
      if (wiping) acc = 0; else acc += dt;
      while (acc >= TIC) { screenObj.tick(); acc -= TIC; }
      if (appState === 'finale' && finale.song && finale.song !== currentSong) updateMusic();   // 둠2: 이야기 → 출연진 소개로 곡이 바뀐다
      setTint(0);
      screenObj.draw(screenBuf);
      present(dt);
      if (screenObj.done) afterScreen();
    } else {
      // 타이틀 화면
      setTint(0);
      menu.draw(screenBuf, now);
      present(dt);
    }
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

fetchDefault();

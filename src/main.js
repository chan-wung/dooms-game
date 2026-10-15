import { Wad } from './wad/wad.js';
import { loadLevel } from './wad/level.js';
import { Automap } from './ui/automap.js';
import { Renderer } from './render/renderer.js';
import { Screen } from './render/screen.js';
import { loadPalette } from './gfx/palette.js';
import { TextureStore } from './gfx/textures.js';
import { Game, TICRATE } from './game/game.js';
import { MOUSE_SENS } from './game/player.js';

const $ = (id) => document.getElementById(id);
const $status = $('status'), $drop = $('drop'), $file = $('file');
const $bar = $('bar'), $stage = $('stage'), $help = $('help'), $hud = $('hud');
const $view = $('view'), $canvas = $('automap'), $mapSel = $('mapSel'), $mapOpts = $('mapOpts');
const $follow = $('optFollow'), $flat = $('optFlat'), $things = $('optThings'), $mode = $('btnMode');
const $msg = $('msg'), $overlay = $('overlay'), $hurt = $('hurt');

const WAD_URL = '/wad/DOOM1.WAD';
const TIC = 1 / TICRATE;
const TURN_UNIT = (Math.PI * 2) / 65536; // 원작 각도 단위 → 라디안

let wad = null, level = null, game = null, mapName = null;
let showAutomap = false;
let mouseDX = 0, acc = 0;
const automap = new Automap($canvas);
let renderer = null, screen = null; // WAD 로드 후 생성 (팔레트/텍스처 필요)
const keys = Object.create(null);

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
  if (automapOn) { document.exitPointerLock?.(); resizeAutomap(); automap.fit(); }
};

// ---------- 레벨 진행 ----------
/** 출구 다음 맵 (일반/비밀 출구). null 이면 에피소드 끝 */
const nextMapName = (name, secret) => {
  const m = /^E(\d)M(\d)$/.exec(name);
  if (!m) return null;
  const e = Number(m[1]), n = Number(m[2]);
  const returnTo = { 1: 4, 2: 6, 3: 7 }; // 비밀 맵(M9)에서 나오면 돌아가는 곳
  if (secret) return `E${e}M9`;
  if (n === 9) return `E${e}M${returnTo[e]}`;
  if (n === 8) return null;                // 에피소드 마지막
  return `E${e}M${n + 1}`;
};

const openMap = (name) => {
  try {
    level = loadLevel(wad, name);
    game = new Game(level);
    mapName = name;
    automap.setLevel(level, game.player);
    window.level = level; window.game = game; window.player = game.player; // 콘솔 디버깅용
    $mapSel.value = name;
    $overlay.hidden = true;
    acc = 0;
    $status.textContent =
      `${name} — 정점 ${level.vertexes.length} · 선 ${level.linedefs.length} · 섹터 ${level.sectors.length} · ` +
      `things ${level.things.length} · segs ${level.segs.length} · 서브섹터 ${level.subsectors.length} · 노드 ${level.nodes.length}`;
  } catch (err) {
    $status.textContent = `${name} 로드 실패: ${err.message}`;
    console.error(err);
  }
};

const startWad = (buf, source) => {
  try {
    wad = new Wad(buf);
    const gfx = { palette: loadPalette(wad), textures: new TextureStore(wad) };
    renderer = new Renderer(gfx);
    screen = new Screen($view, renderer.pixels);
    window.gfx = gfx;
  } catch (err) {
    wad = null;
    $status.textContent = `WAD 로딩 실패: ${err.message}`;
    console.error(err);
    return;
  }
  window.wad = wad;
  const maps = wad.getMapNames();
  if (!maps.length) { $status.textContent = `${source}: 맵이 없는 WAD입니다.`; return; }
  $drop.hidden = true;
  $bar.hidden = $stage.hidden = $help.hidden = false;
  $mapSel.replaceChildren(...maps.map((m) => new Option(m, m)));
  setMode(false);
  openMap(maps.includes('E1M1') ? 'E1M1' : maps[0]);
};

// ---------- WAD 로딩 ----------
const fetchDefault = async () => {
  try {
    const res = await fetch(WAD_URL);
    const type = res.headers.get('content-type') || '';
    // Vite dev 서버는 없는 파일에 index.html(SPA 폴백)을 돌려주므로 확인 필요
    if (!res.ok || type.includes('text/html')) throw new Error('not found');
    startWad(await res.arrayBuffer(), WAD_URL);
  } catch {
    $status.textContent = `${WAD_URL} 를 찾지 못했습니다. 아래에 WAD 파일을 직접 지정하세요.`;
  }
};
$file.addEventListener('change', async () => {
  const f = $file.files[0];
  if (f) startWad(await f.arrayBuffer(), f.name);
});
$drop.addEventListener('dragover', (e) => { e.preventDefault(); $drop.classList.add('over'); });
$drop.addEventListener('dragleave', () => $drop.classList.remove('over'));
$drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  $drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) startWad(await f.arrayBuffer(), f.name);
});

// ---------- UI 이벤트 ----------
$mapSel.addEventListener('change', () => { $mapSel.blur(); openMap($mapSel.value); });
$mode.addEventListener('click', () => { $mode.blur(); setMode(!showAutomap); });
$follow.addEventListener('change', () => { automap.follow = $follow.checked; });
$flat.addEventListener('change', () => { automap.showFlat = $flat.checked; });
$things.addEventListener('change', () => { automap.showThings = $things.checked; });
$('btnFit').addEventListener('click', () => {
  $follow.checked = automap.follow = false;
  automap.fit();
});

const toggle = ($el) => { $el.checked = !$el.checked; $el.dispatchEvent(new Event('change')); };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return; // 맵 선택 중엔 키 입력 무시
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!wad || e.repeat) return;
  if (e.code === 'Tab') setMode(!showAutomap);
  if (e.code === 'KeyR') openMap(mapName);
  if (e.code === 'Enter' && game?.exited) {
    const next = nextMapName(mapName, game.exited.secret);
    if (next && wad.has(next)) openMap(next);
  }
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

// 마우스 시점 (Pointer Lock)
$view.addEventListener('click', () => { if (document.pointerLockElement !== $view) $view.requestPointerLock(); });
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === $view) mouseDX += e.movementX; });

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

// ---------- 입력 → 원작 명령 단위 ----------
const buildCmd = () => {
  const run = keys.ShiftLeft || keys.ShiftRight;
  const dir = (pos, neg) => (pos ? 1 : 0) - (neg ? 1 : 0);
  return {
    forward: dir(keys.KeyW || keys.ArrowUp, keys.KeyS || keys.ArrowDown) * (run ? 50 : 25),
    side: dir(keys.KeyD, keys.KeyA) * (run ? 40 : 24),
    turn: dir(keys.ArrowLeft, keys.ArrowRight) * (run ? 1280 : 640) * TURN_UNIT,
    use: !!(keys.KeyE || keys.Space),
  };
};

// ---------- 오버레이 (출구 / 사망 / 메시지) ----------
const mmss = (tics) => `${Math.floor(tics / TICRATE / 60)}:${String(Math.floor(tics / TICRATE) % 60).padStart(2, '0')}`;
const updateOverlay = () => {
  const p = game.player;
  $msg.textContent = game.message;
  $hurt.style.opacity = game.flashDamage > 0 ? String(Math.min(0.5, game.flashDamage * 0.1)) : '0';
  if (game.exited) {
    const next = nextMapName(mapName, game.exited.secret);
    $overlay.hidden = false;
    $overlay.innerHTML =
      `<b>${mapName} 완료</b><br>시간 ${mmss(game.exited.time)} · 비밀 ${game.secretsFound}/${game.secretsTotal}<br><br>` +
      (next ? `<span>Enter: ${next} 로 이동</span>` : '<span>THE END — 에피소드 클리어!</span>') + '<br><span>R: 다시 하기</span>';
  } else if (p.dead) {
    $overlay.hidden = false;
    $overlay.innerHTML = '<b>YOU DIED</b><br><br><span>R: 다시 시작</span>';
  } else {
    $overlay.hidden = true;
  }
};

// ---------- 루프 ----------
let last = performance.now(), fps = 0, hudTimer = 0;
const frame = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;

  if (game) {
    const p = game.player;
    if (mouseDX) { if (!p.dead && !game.exited) p.turnBy(-mouseDX * MOUSE_SENS); mouseDX = 0; }

    // 로직은 35Hz 고정 tic, 화면은 매 프레임 (tic 사이는 위치 보간)
    acc += dt;
    while (acc >= TIC) { game.tick(buildCmd()); acc -= TIC; }

    if (showAutomap) {
      resizeAutomap();
      automap.tick();
      automap.draw();
    } else {
      renderer.render(game.level, p.view(acc / TIC));
      screen.present();
    }
    updateOverlay();

    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.25;
      $hud.textContent =
        `FPS ${fps.toFixed(0)} · HP ${p.health} · 위치 (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) · ` +
        `각도 ${(((p.angle * 180) / Math.PI) % 360 + 360) % 360 | 0}° · ` +
        `바닥 ${p.sector.floorHeight} / 천장 ${p.sector.ceilingHeight} · 비밀 ${game.secretsFound}/${game.secretsTotal}` +
        (p.noclip ? ' · NOCLIP' : '');
    }
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

fetchDefault();

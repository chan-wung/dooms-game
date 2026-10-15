import { Wad } from './wad/wad.js';
import { loadLevel } from './wad/level.js';
import { Automap } from './ui/automap.js';
import { Renderer } from './render/renderer.js';
import { Screen } from './render/screen.js';
import { loadPalette } from './gfx/palette.js';
import { TextureStore } from './gfx/textures.js';
import { createPlayer, updatePlayer } from './game/player.js';

const $ = (id) => document.getElementById(id);
const $status = $('status'), $drop = $('drop'), $file = $('file');
const $bar = $('bar'), $stage = $('stage'), $help = $('help'), $hud = $('hud');
const $view = $('view'), $canvas = $('automap'), $mapSel = $('mapSel'), $mapOpts = $('mapOpts');
const $follow = $('optFollow'), $flat = $('optFlat'), $things = $('optThings'), $mode = $('btnMode');

const WAD_URL = '/wad/DOOM1.WAD';

let wad = null, level = null, player = null;
let showAutomap = false;
let mouseDX = 0;
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

// ---------- 레벨 선택 ----------
const openMap = (name) => {
  try {
    level = loadLevel(wad, name);
    player = createPlayer(level);
    automap.setLevel(level, player);
    window.level = level; window.player = player; // 콘솔 디버깅용
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
  if (e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
  if (e.code === 'Tab' && wad && !e.repeat) setMode(!showAutomap);
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

// ---------- 루프 ----------
let last = performance.now(), fps = 0, hudTimer = 0;
const frame = (now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;
  if (level) {
    updatePlayer(player, level, dt, keys, mouseDX);
    mouseDX = 0;
    if (showAutomap) {
      resizeAutomap();
      automap.tick();
      automap.draw();
    } else {
      renderer.render(level, player);
      screen.present();
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.25;
      $hud.textContent =
        `FPS ${fps.toFixed(0)} · 위치 (${player.x.toFixed(0)}, ${player.y.toFixed(0)}) · ` +
        `각도 ${(((player.angle * 180) / Math.PI) % 360 + 360) % 360 | 0}° · ` +
        `바닥 ${player.sector.floorHeight} / 천장 ${player.sector.ceilingHeight} · segs ${renderer.segsDrawn}`;
    }
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

fetchDefault();

import { Wad } from './wad/wad.js';
import { loadLevel } from './wad/level.js';
import { Automap } from './ui/automap.js';

const $ = (id) => document.getElementById(id);
const $status = $('status'), $drop = $('drop'), $file = $('file');
const $canvas = $('automap'), $bar = $('bar'), $help = $('help'), $mapSel = $('mapSel');
const $follow = $('optFollow'), $flat = $('optFlat'), $things = $('optThings');

const WAD_URL = '/wad/DOOM1.WAD';

let wad = null;
const automap = new Automap($canvas);
const keys = Object.create(null);

// ---------- 캔버스 크기 (DPR 반영) ----------
const resize = () => {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor($canvas.clientWidth * dpr), h = Math.floor($canvas.clientHeight * dpr);
  if ($canvas.width !== w || $canvas.height !== h) { $canvas.width = w; $canvas.height = h; }
};

// ---------- 레벨 선택 ----------
const openMap = (name) => {
  try {
    const level = loadLevel(wad, name);
    automap.setLevel(level);
    window.level = level; // 콘솔 디버깅용
    $status.textContent =
      `${name} — 정점 ${level.vertexes.length} · 선 ${level.linedefs.length} · 섹터 ${level.sectors.length} · ` +
      `things ${level.things.length} · segs ${level.segs.length} · 서브섹터 ${level.subsectors.length} · 노드 ${level.nodes.length}\n` +
      `플레이어 시작: (${level.playerStart?.x}, ${level.playerStart?.y}) 각도 ${level.playerStart?.angle}°`;
  } catch (err) {
    $status.textContent = `${name} 로드 실패: ${err.message}`;
    console.error(err);
  }
};

const startWad = (buf, source) => {
  try {
    wad = new Wad(buf);
  } catch (err) {
    $status.textContent = `WAD 파싱 실패: ${err.message}`;
    return;
  }
  window.wad = wad;
  const maps = wad.getMapNames();
  if (!maps.length) { $status.textContent = `${source}: 맵이 없는 WAD입니다.`; return; }
  $drop.hidden = true;
  $bar.hidden = $canvas.hidden = $help.hidden = false;
  $mapSel.replaceChildren(...maps.map((m) => new Option(m, m)));
  resize();
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
$mapSel.addEventListener('change', () => openMap($mapSel.value));
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
  if (e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'KeyF') toggle($follow);
  if (e.code === 'KeyT') toggle($things);
  if (e.code === 'Digit0' && wad) $('btnFit').click();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// 팬 (드래그) / 줌 (휠)
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
let last = performance.now();
const frame = (now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (wad && automap.level) {
    resize();
    automap.update(dt, keys);
    automap.draw();
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

fetchDefault();

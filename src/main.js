import { Wad } from './wad/wad.js';

const $status = document.getElementById('status');
const $lumps = document.getElementById('lumps');
const $drop = document.getElementById('drop');
const $file = document.getElementById('file');

const WAD_URL = '/wad/DOOM1.WAD';

const showWad = (wad, source) => {
  const maps = wad.getMapNames();
  const sprites = wad.getLumpsBetween('S_START', 'S_END').length;
  const flats = wad.getLumpsBetween('F_START', 'F_END').length;
  $drop.hidden = true;
  $status.textContent =
    `${source} 로드 완료 — ${wad.type}, lump ${wad.lumps.length}개\n` +
    `맵: ${maps.join(', ') || '(없음)'}  ${wad.has('E1M1') ? '✔ E1M1 존재' : '✘ E1M1 없음'}\n` +
    `스프라이트 ${sprites}개 · 플랫 ${flats}개 · PLAYPAL ${wad.has('PLAYPAL') ? '✔' : '✘'} · TEXTURE1 ${wad.has('TEXTURE1') ? '✔' : '✘'}`;
  $lumps.textContent = wad.lumps.slice(0, 60)
    .map((l, i) => `${String(i).padStart(4)}  ${l.name.padEnd(9)} ${String(l.size).padStart(8)} B`)
    .join('\n') + '\n…';
  window.wad = wad; // 콘솔 디버깅용
};

const loadBuffer = (buf, source) => {
  try {
    showWad(new Wad(buf), source);
  } catch (err) {
    $status.textContent = `WAD 파싱 실패: ${err.message}`;
  }
};

const fetchDefault = async () => {
  try {
    const res = await fetch(WAD_URL);
    const type = res.headers.get('content-type') || '';
    // Vite dev 서버는 없는 파일에 index.html(SPA 폴백)을 돌려주므로 확인 필요
    if (!res.ok || type.includes('text/html')) throw new Error('not found');
    loadBuffer(await res.arrayBuffer(), WAD_URL);
  } catch {
    $status.textContent = `${WAD_URL} 를 찾지 못했습니다. 아래에 WAD 파일을 직접 지정하세요.`;
  }
};

$file.addEventListener('change', async () => {
  const f = $file.files[0];
  if (f) loadBuffer(await f.arrayBuffer(), f.name);
});
$drop.addEventListener('dragover', (e) => { e.preventDefault(); $drop.classList.add('over'); });
$drop.addEventListener('dragleave', () => $drop.classList.remove('over'));
$drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  $drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) loadBuffer(await f.arrayBuffer(), f.name);
});

fetchDefault();

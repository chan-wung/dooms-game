/**
 * 한글 글꼴 (갈무리 9, OFL). WAD 글꼴(STCFN)에는 한글이 없어서, 글자를 오프스크린 캔버스에 그려
 * 1비트 마스크로 바꾼 뒤 화면 버퍼에 찍는다. 픽셀 글꼴이라 원래 크기에서는 또렷하게 나온다.
 */
const FAMILY = 'Galmuri9';
const SIZE = 9;
const LINE_H = 12;
const CACHE_MAX = 800;

const cache = new Map();
let ready = false;
let canvas = null, ctx = null;

/** 글꼴 파일을 불러온다 (실패해도 게임은 계속 — 시스템 글꼴로 대신 그린다) */
export async function loadFont() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return false;
  try {
    const face = new FontFace(FAMILY, 'url(/fonts/Galmuri9.woff2)');
    await face.load();
    document.fonts.add(face);
    ready = true;
  } catch { /* 시스템 글꼴 */ }
  cache.clear();
  return ready;
}

/** ASCII 밖 글자(한글 등)가 있는가 */
export const needsGlyph = (str) => /[^\x00-\x7f]/.test(str);

/** 문자열 → { width, height, mask } (캔버스를 못 쓰는 환경이면 null) */
export function glyphRun(str) {
  if (typeof document === 'undefined') return null;
  let run = cache.get(str);
  if (run) return run;
  if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
  if (!ctx) return null;
  const font = `${SIZE}px ${FAMILY}, "Malgun Gothic", sans-serif`;
  ctx.font = font;
  const width = Math.max(1, Math.ceil(ctx.measureText(str).width));
  canvas.width = width; canvas.height = LINE_H;           // 크기를 바꾸면 설정이 지워지므로 다시 지정
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.fillText(str, 0, 1);
  const px = ctx.getImageData(0, 0, width, LINE_H).data;
  const mask = new Uint8Array(width * LINE_H);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  run = { width, height: LINE_H, mask };
  if (ready) {                                              // 글꼴이 준비되기 전 모양은 기억하지 않는다
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(str, run);
  }
  return run;
}

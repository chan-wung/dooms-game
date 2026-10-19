/**
 * 한글 글자 그리기. WAD 글꼴(STCFN)에는 한글이 없고, 320×200 버퍼에 한글을 찍으면 획이 뭉개져 읽기 어렵다.
 * 그래서 한글이 든 문구는 버퍼에 찍지 않고 Hud 가 목록으로 모아 두었다가(Hud.text), 화면 위에 겹친 캔버스에
 * 실제 화면 해상도로 그린다 (Neo둥근모 도트 글꼴, OFL · 붉은 그라데이션 + 어두운 테두리). 좌표·크기는 320×200 기준이다.
 */
const FAMILY = 'NeoDGM, Pretendard, "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
export const TEXT_SIZE = 10.5;      // 메뉴·확인창
export const SMALL_SIZE = 9.5;       // 줄이 많은 이야기 화면

/** 글꼴 파일을 불러온다 (실패하면 시스템 글꼴로 그린다). 불러온 뒤의 프레임부터 새 글꼴로 그려진다 */
export async function loadFont() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return false;
  try {
    const face = new FontFace('NeoDGM', 'url(/fonts/NeoDGM.woff2)');
    await face.load();
    document.fonts.add(face);
    return true;
  } catch { return false; }
}

/** ASCII 밖 글자(한글 등)가 있는가 */
export const needsGlyph = (str) => /[^\x00-\x7f]/.test(str);

let mctx = null;
/** 글자 폭 (320×200 기준 픽셀). 캔버스를 못 쓰는 환경(Node 테스트)에서는 어림값 */
export function measure(str, size = TEXT_SIZE) {
  if (typeof document === 'undefined') return Math.ceil([...str].length * size * 0.9);
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `700 ${size}px ${FAMILY}`;
  return Math.ceil(mctx.measureText(str).width);
}

/** 화면(#view) 위에 겹쳐 한글 문구를 그리는 캔버스 */
export class TextLayer {
  /** @param {HTMLCanvasElement} view 게임 화면 캔버스 */
  constructor(view) {
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'textLayer';
    this.canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:2';
    view.after(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.dirty = false;
  }

  /** items: [{ str, x, y, size }] (320×200 좌표). 빈 목록이면 지운다 */
  render(items) {
    if (!items.length && !this.dirty) return;
    const v = this.view, c = this.canvas, ctx = this.ctx;
    const w = v.clientWidth, h = v.clientHeight, dpr = window.devicePixelRatio || 1;
    c.style.left = `${v.offsetLeft + v.clientLeft}px`; c.style.top = `${v.offsetTop + v.clientTop}px`;
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; } else ctx.clearRect(0, 0, pw, ph);
    this.dirty = items.length > 0;
    if (!this.dirty || v.hidden) return;
    const sx = pw / 320, sy = ph / 200;
    ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a0000';
    for (const { str, x, y, size } of items) {
      const px = size * sy;
      ctx.font = `700 ${px}px ${FAMILY}`;
      ctx.lineWidth = Math.max(2, px * 0.28);
      const top = (y - 1) * sy, grad = ctx.createLinearGradient(0, top, 0, top + px);   // 위는 밝은 붉은색, 아래는 진한 붉은색
      grad.addColorStop(0, '#ff7a5a'); grad.addColorStop(1, '#d01818');
      ctx.fillStyle = grad;
      ctx.strokeText(str, x * sx, top);
      ctx.fillText(str, x * sx, top);
    }
  }
}

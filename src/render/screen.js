import { SCREEN_W, SCREEN_H } from './renderer.js';

/** 렌더러의 Uint32 픽셀 버퍼를 캔버스에 올린다 */
export class Screen {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, pixels) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d');
    this.image = new ImageData(new Uint8ClampedArray(pixels.buffer), SCREEN_W, SCREEN_H);
  }

  present() { this.ctx.putImageData(this.image, 0, 0); }
}

import { SCREEN_W, SCREEN_H } from './renderer.js';

/**
 * 화면 녹는 전환 (원작 f_wipe.c wipe_Melt).
 * 옛 화면이 160개 열(폭 2픽셀)로 쪼개져 열마다 시작이 조금씩 다르게 아래로 흘러내리고, 그 위로 새 화면이 드러난다.
 * start(옛 화면) → 매 tic tick() → 새 화면을 그린 buffer 에 draw() 로 덧그리기. done 이 되면 끝.
 */
const COLS = SCREEN_W / 2;
const SLIDE = 8;   // 한 번 흘러내리기 시작한 열이 tic 마다 내려가는 픽셀 수

export class Wipe {
  /** @param rnd 0..255 난수 (기본은 Math.random) */
  constructor(rnd = () => Math.floor(Math.random() * 256)) {
    this.rnd = rnd;
    this.old = new Uint32Array(SCREEN_W * SCREEN_H);
    this.y = new Int16Array(COLS);
    this.done = true;
  }

  start(frame) {
    this.old.set(frame);
    // 열마다 시작 지연: 이웃과 -1/0/+1 만 다르다 (원작 그대로, 처음은 0 ~ -15)
    this.y[0] = -(this.rnd() % 16);
    for (let i = 1; i < COLS; i++) {
      const y = this.y[i - 1] + (this.rnd() % 3) - 1;
      this.y[i] = y > 0 ? 0 : y === -16 ? -15 : y;
    }
    this.done = false;
  }

  tick() {
    if (this.done) return;
    let all = true;
    for (let i = 0; i < COLS; i++) {
      const y = this.y[i];
      if (y < 0) { this.y[i]++; all = false; }
      else if (y < SCREEN_H) {
        const dy = y < 16 ? y + 1 : SLIDE;
        this.y[i] = Math.min(SCREEN_H, y + dy);
        all = false;
      }
    }
    this.done = all;
  }

  /** frame = 새 화면. 옛 화면의 열을 y 만큼 내려서 그 위에 덧그린다 */
  draw(frame) {
    if (this.done) return;
    const W = SCREEN_W, H = SCREEN_H, old = this.old;
    for (let i = 0; i < COLS; i++) {
      const y = this.y[i];
      for (let x = i * 2; x < i * 2 + 2; x++) {
        if (y < 0) { for (let r = 0; r < H; r++) frame[r * W + x] = old[r * W + x]; }       // 아직 시작 전: 옛 화면 그대로
        else for (let r = y; r < H; r++) frame[r * W + x] = old[(r - y) * W + x];             // 옛 열이 y 만큼 내려옴 (위쪽은 새 화면)
      }
    }
  }
}

/** 게임 로직 공용 도우미: 각도, 오차(spread), 이동 분할 */
export const TWO_PI = Math.PI * 2;

/** 각도를 -π..π 로 */
export const normAngle = (a) => { a %= TWO_PI; return a > Math.PI ? a - TWO_PI : a < -Math.PI ? a + TWO_PI : a; };

/** 원작의 (P_Random()-P_Random()) << shift 오차를 라디안으로 (shift 20 → 약 ±22°, 21 → ±44°) */
export const spread = (game, shift) => ((game.rnd() - game.rnd()) * TWO_PI) / 2 ** (32 - shift);

/**
 * 한 번에 maxStep 보다 크게 움직이면 반씩 나눠 step(dx, dy) 를 부른다 (벽 통과 방지).
 * step 이 false 를 돌려주면 거기서 멈춘다.
 */
export function splitMove(mx, my, maxStep, step) {
  do {
    let px, py;
    if (Math.abs(mx) > maxStep || Math.abs(my) > maxStep) { px = mx / 2; py = my / 2; mx /= 2; my /= 2; }
    else { px = mx; py = my; mx = my = 0; }
    if (step(px, py) === false) return;
  } while (mx !== 0 || my !== 0);
}

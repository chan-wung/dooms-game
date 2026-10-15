/** 키보드·마우스·터치 입력을 모았다가 매 tic 원작 명령 단위로 바꾼다 */
export const TURN_UNIT = (Math.PI * 2) / 65536; // 원작 각도 단위 → 라디안

const dir = (pos, neg) => (pos ? 1 : 0) - (neg ? 1 : 0);

export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.touch = null;          // TouchControls (터치 기기에서만)
    this.mouseDX = 0;           // 다음 프레임에 처리할 마우스 이동
    this.mouseFire = false;
    this.wheel = 0;             // 다음 tic 에 처리할 무기 순환
    this.weaponKey = 0;         // 다음 tic 에 처리할 무기 번호
  }

  /** 눌려 있던 키가 메뉴 뒤에서 계속 먹지 않게 */
  releaseAll() {
    for (const k in this.keys) delete this.keys[k];
    this.mouseFire = false;
  }

  /** tic 하나를 처리한 뒤: 한 번만 처리할 입력을 비운다 */
  endTic() { this.weaponKey = 0; this.wheel = 0; }

  buildCmd() {
    const { keys, touch } = this;
    const run = keys.ShiftLeft || keys.ShiftRight;
    let forward = dir(keys.KeyW || keys.ArrowUp, keys.KeyS || keys.ArrowDown) * (run ? 50 : 25);
    let side = dir(keys.KeyD, keys.KeyA) * (run ? 40 : 24);
    let use = !!(keys.KeyE || keys.Space), cycle = Math.sign(this.wheel), weapon = this.weaponKey;
    if (touch) {                                   // 조이스틱은 기울인 만큼 연속적으로
      forward += Math.round(-touch.move.y * 50); side += Math.round(touch.move.x * 40);
      const q = touch.takeQueued(); use = use || q.use; cycle = cycle || q.cycle; weapon = weapon || q.weapon;
    }
    return {
      forward: Math.max(-50, Math.min(50, forward)),
      side: Math.max(-40, Math.min(40, side)),
      turn: dir(keys.ArrowLeft, keys.ArrowRight) * (run ? 1280 : 640) * TURN_UNIT,
      use,
      fire: !!(keys.ControlLeft || keys.ControlRight || keys.KeyF || this.mouseFire || touch?.fire),
      weapon,
      cycle,
    };
  }
}

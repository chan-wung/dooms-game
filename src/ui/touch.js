/**
 * 모바일 터치 조작: 왼쪽 가상 조이스틱(이동/좌우 걷기), 오른쪽 화면 드래그(시점 회전),
 * 발사·사용·무기 교체·오토맵·메뉴 버튼. 터치 기기이거나 주소에 ?touch=1 이 있을 때만 켠다.
 */
export const isTouchDevice = () =>
  new URLSearchParams(location.search).has('touch')
  || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window;

const STICK_RADIUS = 56;
const TURN_STICK_PX_PER_SEC = 600; // 오른쪽 스틱을 끝까지 밀었을 때의 드래그 환산 속도

/** 포인터 캡처(손가락이 요소 밖으로 나가도 계속 추적). 일부 환경에서 실패해도 조작은 계속되게 */
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* 무시 */ } };

export class TouchControls {
  /** @param {HTMLElement} root 컨트롤이 놓일 곳(#stage), handlers = { menu(), map() } */
  constructor(root, handlers) {
    this.move = { x: 0, y: 0 };   // -1..1 (y: 위가 -1 = 앞으로)
    this.look = { x: 0, y: 0 };   // 오른쪽 스틱: x 만 사용 (좌우 회전)
    this.weaponQueued = 0;        // 번호 버튼으로 고른 무기
    this.fire = false;
    this.useQueued = false;
    this.cycleQueued = 0;
    this.turnDx = 0;              // 이번 프레임에 쌓인 가로 드래그(px)
    this.handlers = handlers;

    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-turn"></div>
      <div class="t-stick t-move"><div class="t-thumb"></div></div>
      <div class="t-stick t-look"><div class="t-thumb"></div></div>
      <button class="t-btn t-fire">FIRE</button>
      <button class="t-btn t-use">USE</button>
      <div class="t-weapons">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="t-wbtn" data-w="${n}">${n}</button>`).join('')}</div>
      <button class="t-small t-menu">MENU</button>
      <button class="t-small t-map">MAP</button>`;
    root.appendChild(el);
    this.el = el;

    this.bindStick(el.querySelector('.t-move'), el.querySelector('.t-move .t-thumb'), this.move);
    this.bindStick(el.querySelector('.t-look'), el.querySelector('.t-look .t-thumb'), this.look);
    this.bindTurn(el.querySelector('.t-turn'));
    this.bindHold(el.querySelector('.t-fire'), (on) => { this.fire = on; });
    this.bindHold(el.querySelector('.t-use'), (on) => { if (on) this.useQueued = true; });
    el.querySelectorAll('.t-wbtn').forEach((b) => this.bindHold(b, (on) => { if (on) this.weaponQueued = Number(b.dataset.w); }));
    this.bindHold(el.querySelector('.t-menu'), (on) => { if (on) handlers.menu(); });
    this.bindHold(el.querySelector('.t-map'), (on) => { if (on) handlers.map(); });
  }

  bindHold(button, fn) {
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(true); capture(button, e.pointerId); });
    const up = () => fn(false);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  }

  bindStick(base, thumb, out) {
    let id = null, cx = 0, cy = 0;
    const set = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx = (dx / len) * STICK_RADIUS; dy = (dy / len) * STICK_RADIUS; }
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS;
      const dead = (v) => (Math.abs(v) < 0.2 ? 0 : v);   // 살짝 건드린 건 무시
      out.x = dead(nx); out.y = dead(ny);
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e);
      capture(base, id);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; out.x = out.y = 0; thumb.style.transform = '';
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  bindTurn(area) {
    let id = null, lastX = 0;
    area.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; lastX = e.clientX; capture(area, id); });
    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.turnDx += e.clientX - lastX;
      lastX = e.clientX;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  }

  /** 프레임마다: 쌓인 회전량을 꺼내 간다 */
  takeTurn(dt = 0.016) { const d = this.turnDx + this.look.x * TURN_STICK_PX_PER_SEC * dt; this.turnDx = 0; return d; }
  /** tic 마다: 한 번만 처리할 입력을 꺼내 간다 */
  takeQueued() {
    const q = { use: this.useQueued, cycle: this.cycleQueued, weapon: this.weaponQueued };
    this.useQueued = false; this.cycleQueued = 0; this.weaponQueued = 0;
    return q;
  }
  show(on) { this.el.hidden = !on; }
}

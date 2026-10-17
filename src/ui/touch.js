/**
 * 모바일 터치 조작: 왼쪽 가상 조이스틱(이동/좌우 걷기), 오른쪽 화면 드래그(시점 회전),
 * 발사·사용·무기 교체·오토맵·메뉴 버튼. 터치 기기이거나 주소에 ?touch=1 이 있을 때만 켠다.
 */
export const isTouchDevice = () =>
  new URLSearchParams(location.search).has('touch')
  || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window;

const HELP_KEY = 'doomjs.touchhelp';
const STICK_RADIUS = 56;
const TURN_STICK_PX_PER_SEC = 950; // 오른쪽 스틱을 끝까지 밀었을 때의 드래그 환산 속도
/**
 * 왼쪽 스틱의 걷는 존 / 뛰는 존: 원 안(STICK_RADIUS)은 걷기, 원 밖 고리(RUN_ZONE 만큼 더)로 끌어내면 달리기.
 * 경계에서 걷기·달리기가 깜빡이지 않게 들어갈 때(RUN_ENTER)와 나올 때(RUN_EXIT)의 기준을 다르게 둔다.
 */
const RUN_ZONE = 28;
const RUN_ENTER = STICK_RADIUS * 1.15, RUN_EXIT = STICK_RADIUS;

/** 포인터 캡처(손가락이 요소 밖으로 나가도 계속 추적). 일부 환경에서 실패해도 조작은 계속되게 */
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* 무시 */ } };

export class TouchControls {
  /** @param {HTMLElement} root 컨트롤이 놓일 곳(#stage), handlers = { menu(), map(), follow(), fit(), fullscreen() } */
  constructor(root, handlers) {
    this.move = { x: 0, y: 0, run: false };   // -1..1 (y: 위가 -1 = 앞으로), run = 뛰는 존
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
      <button class="t-small t-map">MAP</button>
      <button class="t-small t-full">FULL</button>
      <button class="t-small t-mute">SOUND</button>
      <button class="t-small t-follow">FOLLOW</button>
      <button class="t-small t-fit">FIT</button>
      <div class="t-help" hidden>
        <b>조작 방법</b>
        <p><span>왼쪽 스틱</span> 걷기 · 바깥 점선까지 끌어내면 달리기</p>
        <p><span>오른쪽 스틱 · 화면 드래그</span> 둘러보기</p>
        <p><span>FIRE</span> 발사 &nbsp; <span>USE</span> 문·스위치</p>
        <p><span>1~7</span> 무기 선택</p>
        <p><span>MAP</span> 오토맵 (두 손가락으로 확대·축소, 한 손가락으로 이동)</p>
        <p><span>MENU</span> 저장·불러오기·옵션</p>
        <div class="t-opts">
          <button class="t-opt" data-opt="muted"></button>
          <button class="t-opt" data-opt="autoLandscape"></button>
        </div>
        <em>화면을 탭하면 시작합니다</em>
      </div>`;
    root.appendChild(el);
    this.el = el;

    this.bindStick(el.querySelector('.t-move'), el.querySelector('.t-move .t-thumb'), this.move, true);
    this.bindStick(el.querySelector('.t-look'), el.querySelector('.t-look .t-thumb'), this.look);
    this.bindTurn(el.querySelector('.t-turn'));
    this.bindHold(el.querySelector('.t-fire'), (on) => { this.fire = on; });
    this.bindHold(el.querySelector('.t-use'), (on) => { if (on) this.useQueued = true; });
    el.querySelectorAll('.t-wbtn').forEach((b) => this.bindHold(b, (on) => { if (on) this.weaponQueued = Number(b.dataset.w); }));
    this.bindHold(el.querySelector('.t-menu'), (on) => { if (on) handlers.menu(); });
    this.bindHold(el.querySelector('.t-map'), (on) => { if (on) handlers.map(); });
    const full = el.querySelector('.t-full');
    this.bindHold(full, (on) => { if (on) handlers.fullscreen(); });
    const syncFull = () => { full.hidden = !!document.fullscreenElement || !root.requestFullscreen; };   // 전체화면이 되면(또는 못 쓰는 기기면) 숨김
    document.addEventListener('fullscreenchange', syncFull);
    syncFull();
    this.bindHold(el.querySelector('.t-follow'), (on) => { if (on) handlers.follow(); });
    this.bindHold(el.querySelector('.t-fit'), (on) => { if (on) handlers.fit(); });

    this.helpEl = el.querySelector('.t-help');
    this.helpEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.hideHelp(); });

    // 첫 안내 창의 옵션 토글 (누르면 창이 닫히지 않는다) + 상단 소리 버튼
    const LABELS = {
      muted: ['소리 끄기', (on) => (on ? '켬 (무음)' : '끔')],
      autoLandscape: ['시작할 때 전체화면 · 가로 고정', (on) => (on ? '켬' : '끔')],
    };
    const mute = el.querySelector('.t-mute');
    this.syncOpts = () => {
      const o = handlers.getOpts();
      el.querySelectorAll('.t-opt').forEach((b) => {
        const [name, state] = LABELS[b.dataset.opt];
        b.textContent = `${name} : ${state(o[b.dataset.opt])}`;
        b.classList.toggle('on', o[b.dataset.opt]);
      });
      mute.textContent = o.muted ? 'MUTED' : 'SOUND';
      mute.classList.toggle('on', o.muted);
    };
    const toggleOpt = (key) => { handlers.setOpt(key, !handlers.getOpts()[key]); this.syncOpts(); };
    el.querySelectorAll('.t-opt').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggleOpt(b.dataset.opt); });
    });
    this.bindHold(mute, (on) => { if (on) toggleOpt('muted'); });
    this.syncOpts();
  }

  /** 오토맵을 보는 동안: 조작 버튼을 숨기고 화면 제스처(확대·이동)를 캔버스로 넘긴다 */
  setAutomap(on) { this.el.classList.toggle('automap', on); }

  /** 처음 한 번만 조작 안내 (게임은 안내를 닫을 때까지 멈춘다) */
  showHelpOnce() {
    try { if (localStorage.getItem(HELP_KEY)) return; } catch { /* 저장소를 못 쓰면 매번 보여준다 */ }
    this.helpEl.hidden = false;
  }

  hideHelp() {
    this.helpEl.hidden = true;
    try { localStorage.setItem(HELP_KEY, '1'); } catch { /* 무시 */ }
    this.handlers.onHelpClosed?.();
  }

  get helpOpen() { return !this.helpEl.hidden; }

  bindHold(button, fn) {
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(true); capture(button, e.pointerId); });
    const up = () => fn(false);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  }

  /** runZone: 원 밖 고리까지 끌어낼 수 있고, 거기서는 out.run = true (왼쪽 이동 스틱) */
  bindStick(base, thumb, out, runZone = false) {
    let id = null, cx = 0, cy = 0;
    const setRun = (on) => {
      if (on === out.run) return;
      out.run = on;
      base.classList.toggle('running', on);
      if (on) { try { navigator.vibrate?.(15); } catch { /* 진동을 못 쓰는 기기 */ } }
    };
    const set = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (runZone) setRun(out.run ? len >= RUN_EXIT : len >= RUN_ENTER);
      // 엄지는 뛰는 존 고리까지 따라가지만, 방향 세기는 원 반지름 기준 (원 끝 = 1)
      const reach = runZone ? STICK_RADIUS + RUN_ZONE : STICK_RADIUS;
      const shown = Math.min(len, reach), k = len ? shown / len : 0;
      thumb.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const s = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      const nx = (dx * s) / STICK_RADIUS, ny = (dy * s) / STICK_RADIUS;
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
      if (runZone) setRun(false);
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

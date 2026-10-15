/**
 * 맵을 클리어했을 때의 화면 (원작 wi_stuff.c / f_finale.c 의 좌표·타이밍·소리).
 *  1. Intermission 통계 화면: KILLS / ITEMS / SECRET / TIME / PAR 가 하나씩 올라간다
 *  2. 다음 맵 화면: 지도 위에 지나온 곳(WISPLAT)과 "YOU ARE HERE"(WIURH) 를 깜빡이며 보여준다
 *  3. Finale 에피소드 엔딩: 바닥 무늬 위에 글자가 한 자씩 찍히고, 이어서 HELP2 화면
 * 모두 320×200 화면 버퍼에 그린다. tick() 은 35Hz.
 */
import { SCREEN_W as W } from '../render/renderer.js';

const TICRATE = 35;
const SHOW_NEXT_DELAY = 4 * TICRATE;      // 다음 맵 화면을 보여주는 시간
const ANIM_PERIOD = Math.floor(TICRATE / 3);

// 에피소드 1 (Knee-Deep in the Dead) 자료
const PARS = [30, 75, 120, 90, 165, 180, 180, 30, 165];     // E1M1~E1M9 기준 시간(초)
const LNODES = [[185, 164], [148, 143], [69, 122], [209, 102], [116, 89], [166, 55], [71, 24], [135, 29], [71, 24]]; // 지도 위 맵 위치
const MAP_ANIMS = [[224, 104], [184, 160], [112, 136], [72, 112], [88, 96], [64, 48], [192, 40], [136, 16], [80, 16], [64, 24]]; // 지도 배경 애니메이션
const STATS_X = 50, STATS_Y = 50, TIME_X = 16, TIME_Y = 200 - 32, TITLE_Y = 2;

export const parTime = (map) => { const m = /^E1M(\d)$/.exec(map); return m ? PARS[Number(m[1]) - 1] : 0; };
const mapIndex = (map) => Number(/^E\dM(\d)$/.exec(map)?.[1] ?? 1) - 1;
const pct = (n, total) => (total ? Math.floor((n * 100) / total) : 100);

export class Intermission {
  /** @param play (효과음 이름) => void */
  constructor(hud, play) {
    this.hud = hud; this.play = play;
    this.done = false;
  }

  /**
   * @param info { map, next(다음 맵 이름 또는 null), secretExit, kills, killsTotal, items, itemsTotal, secrets, secretsTotal, time(tic) }
   */
  start(info) {
    this.info = info;
    this.last = mapIndex(info.map);
    this.next = info.next ? mapIndex(info.next) : null;
    this.epsd = Number(/^E(\d)/.exec(info.map)?.[1] ?? 1) - 1;
    this.hasMapScreen = this.epsd === 0 && this.next !== null && !!this.hud.patch(`WIMAP${this.epsd}`);
    this.state = 'stats';
    this.view = 'stats';
    this.done = false;
    this.bcnt = 0;
    this.accel = false;
    this.sp = 1;                                   // 홀수 = 잠깐 쉬는 중, 짝수 = 올라가는 중
    this.pause = TICRATE;
    this.cnt = { kills: -1, items: -1, secret: -1, time: -1, par: -1 };
    this.final = {
      kills: pct(info.kills, info.killsTotal), items: pct(info.items, info.itemsTotal), secret: pct(info.secrets, info.secretsTotal),
      time: Math.floor(info.time / TICRATE), par: parTime(info.map),
    };
    this.anims = MAP_ANIMS.map(([x, y]) => ({ x, y, ctr: -1, next: 1 + Math.floor(Math.random() * ANIM_PERIOD) }));
    this.pointerOn = true;
  }

  /** 키/탭: 숫자를 끝까지 채우거나 다음 화면으로 */
  press() { this.accel = true; }

  tick() {
    this.bcnt++;
    for (const a of this.anims) if (this.bcnt === a.next) { a.ctr = (a.ctr + 1) % 3; a.next = this.bcnt + ANIM_PERIOD; }
    if (this.state === 'stats') this.tickStats();
    else if (this.state === 'next') this.tickNext();
    else if (--this.wait <= 0) this.done = true;
  }

  tickStats() {
    const c = this.cnt, f = this.final, p = this.play;
    if (this.accel && this.sp !== 10) {
      this.accel = false;
      Object.assign(c, f);
      p('BAREXP');
      this.sp = 10;
      return;
    }
    const rise = (key, step) => {
      c[key] += step;
      if (!(this.bcnt & 3)) p('PISTOL');
      if (c[key] >= f[key]) { c[key] = f[key]; p('BAREXP'); this.sp++; }
    };
    switch (this.sp) {
      case 2: rise('kills', 2); break;
      case 4: rise('items', 2); break;
      case 6: rise('secret', 2); break;
      case 8:
        if (!(this.bcnt & 3)) p('PISTOL');
        c.time = Math.min(c.time + 3, f.time); c.par = Math.min(c.par + 3, f.par);
        if (c.time >= f.time && c.par >= f.par) { p('BAREXP'); this.sp++; }
        break;
      case 10:
        if (this.accel) { p('SGCOCK'); this.accel = false; if (this.hasMapScreen) this.initNext(); else this.initNoState(); }
        break;
      default:                                     // 홀수: 1초 쉬고 다음 단계
        if (!--this.pause) { this.sp++; this.pause = TICRATE; }
    }
  }

  initNext() { this.state = 'next'; this.view = 'next'; this.accel = false; this.wait = SHOW_NEXT_DELAY; this.pointerOn = true; }
  initNoState() { this.state = 'nostate'; this.accel = false; this.wait = 10; }

  tickNext() {
    if (!--this.wait || this.accel) { this.initNoState(); return; }
    this.pointerOn = (this.wait & 31) < 20;
  }

  // ---------- 그리기 ----------
  draw(frame) {
    const h = this.hud;
    frame.fill(0xff000000);
    h.blit(frame, h.patch(`WIMAP${this.epsd}`), 0, 0);
    for (const [i, a] of this.anims.entries()) if (a.ctr >= 0) h.blit(frame, h.patch(`WIA${this.epsd}${String(i).padStart(2, '0')}${String(a.ctr).padStart(2, '0')}`), a.x, a.y);
    if (this.view === 'stats') this.drawStats(frame); else this.drawNext(frame);
  }

  /** 숫자를 오른쪽 끝 x 에 맞춰 그리고 왼쪽 끝을 돌려준다 (digits < 0 = 자릿수 자동) */
  drawNum(frame, x, y, n, digits) {
    const h = this.hud, fontW = h.patch('WINUM0').width;
    if (digits < 0) digits = n ? String(Math.abs(n)).length : 1;
    const neg = n < 0;
    n = Math.abs(n);
    while (digits--) { x -= fontW; h.blit(frame, h.patch(`WINUM${n % 10}`), x, y); n = Math.floor(n / 10); }
    if (neg) { x -= 8; h.blit(frame, h.patch('WIMINUS'), x, y); }
    return x;
  }

  drawPercent(frame, x, y, v) {
    if (v < 0) return;
    this.hud.blit(frame, this.hud.patch('WIPCNT'), x, y);
    this.drawNum(frame, x, y, v, -1);
  }

  drawTime(frame, x, y, t) {
    if (t < 0) return;
    const h = this.hud;
    if (t > 61 * 59) { const sucks = h.patch('WISUCKS'); h.blit(frame, sucks, x - sucks.width, y); return; }   // 1시간 넘으면 "sucks"
    const colon = h.patch('WICOLON');
    let div = 1;
    do {
      const n = Math.floor(t / div) % 60;
      x = this.drawNum(frame, x, y, n, 2) - colon.width;
      div *= 60;
      if (div === 60 || Math.floor(t / div)) h.blit(frame, colon, x, y);
    } while (Math.floor(t / div));
  }

  /** "E1M3" + "FINISHED!" */
  drawFinished(frame) {
    const h = this.hud, name = h.patch(`WILV${this.epsd}${this.last}`), fin = h.patch('WIF');
    if (!name) return;
    h.blit(frame, name, (W - name.width) >> 1, TITLE_Y);
    h.blit(frame, fin, (W - fin.width) >> 1, TITLE_Y + Math.floor((5 * name.height) / 4));
  }

  drawStats(frame) {
    const h = this.hud, c = this.cnt, lh = Math.floor((3 * h.patch('WINUM0').height) / 2);
    this.drawFinished(frame);
    h.blit(frame, h.patch('WIOSTK'), STATS_X, STATS_Y);
    this.drawPercent(frame, W - STATS_X, STATS_Y, c.kills);
    h.blit(frame, h.patch('WIOSTI'), STATS_X, STATS_Y + lh);
    this.drawPercent(frame, W - STATS_X, STATS_Y + lh, c.items);
    h.blit(frame, h.patch('WISCRT2'), STATS_X, STATS_Y + 2 * lh);
    this.drawPercent(frame, W - STATS_X, STATS_Y + 2 * lh, c.secret);
    h.blit(frame, h.patch('WITIME'), TIME_X, TIME_Y);
    this.drawTime(frame, W / 2 - TIME_X, TIME_Y, c.time);
    h.blit(frame, h.patch('WIPAR'), W / 2 + TIME_X, TIME_Y);
    this.drawTime(frame, W - TIME_X, TIME_Y, c.par);
  }

  /** 지도 위에 지나온 곳 표시 */
  drawOnNode(frame, n, patches) {
    const [x, y] = LNODES[n];
    for (const p of patches) {
      if (!p) continue;
      const left = x - p.leftOffset, top = y - p.topOffset;
      if (left >= 0 && left + p.width < W && top >= 0 && top + p.height < 200) { this.hud.blit(frame, p, x, y); return; }
    }
  }

  drawNext(frame) {
    const h = this.hud;
    const last = this.last === 8 ? this.next - 1 : this.last;           // 비밀 맵에서 돌아올 때는 다음 맵 직전까지
    for (let i = 0; i <= last; i++) this.drawOnNode(frame, i, [h.patch('WISPLAT')]);
    if (this.last === 8) this.drawOnNode(frame, 8, [h.patch('WISPLAT')]);                // 비밀 맵을 거쳐 왔다
    if (this.pointerOn) this.drawOnNode(frame, this.next, [h.patch('WIURH0'), h.patch('WIURH1')]);
    // "ENTERING" + 다음 맵 이름
    const enter = h.patch('WIENTER'), name = h.patch(`WILV${this.epsd}${this.next}`);
    if (!enter || !name) return;
    h.blit(frame, enter, (W - enter.width) >> 1, TITLE_Y);
    h.blit(frame, name, (W - name.width) >> 1, TITLE_Y + Math.floor((5 * name.height) / 4));
  }
}

// ---------- 에피소드 엔딩 (원작 f_finale.c) ----------
const TEXT_SPEED = 3, TEXT_WAIT = 250;
const E1_TEXT = [
  'Once you beat the big badasses and',
  'clean out the moon base you\'re supposed',
  'to win, aren\'t you? Aren\'t you? Where\'s',
  'your fat reward and ticket home? What',
  'the hell is this? It\'s not supposed to',
  'end this way!',
  '',
  'It stinks like rotten meat, but looks',
  'like the lost Deimos base.  Looks like',
  'you\'re stuck on The Shores of Hell.',
  'The only way out is through.',
  '',
  'To continue the DOOM experience, play',
  'The Shores of Hell and its amazing',
  'sequel, Inferno!',
];
const E1_TEXT_LENGTH = E1_TEXT.join('\n').length;

export class Finale {
  constructor(hud) { this.hud = hud; this.done = false; }

  start() { this.count = 0; this.stage = 0; this.done = false; }

  /** 글자가 찍히는 중이면 한 번에 다 보여주고, 다 보였으면 다음 화면으로, 마지막 화면이면 끝 */
  press() {
    const typed = E1_TEXT_LENGTH * TEXT_SPEED + 10;
    if (this.stage === 0) { if (this.count < typed) this.count = typed; else this.stage = 1; }
    else this.done = true;
  }

  tick() {
    this.count++;
    if (this.stage === 0 && this.count > E1_TEXT_LENGTH * TEXT_SPEED + TEXT_WAIT) this.stage = 1;
  }

  draw(frame) {
    const h = this.hud;
    if (this.stage === 1) { h.blit(frame, h.patch('HELP2'), 0, 0); return; }
    h.drawFlat(frame, 'FLOOR4_8');
    let left = Math.max(0, Math.floor((this.count - 10) / TEXT_SPEED));
    E1_TEXT.forEach((line, i) => {
      if (left <= 0) return;
      h.text(frame, line.slice(0, left), 10, 10 + 11 * i);
      left -= line.length + 1;
    });
  }
}

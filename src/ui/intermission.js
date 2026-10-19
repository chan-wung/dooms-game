/**
 * 맵을 클리어했을 때의 화면 (원작 wi_stuff.c / f_finale.c 의 좌표·타이밍·소리).
 *  1. Intermission 통계 화면: KILLS / ITEMS / SECRET / TIME / PAR 가 하나씩 올라간다
 *  2. 다음 맵 화면: 지도 위에 지나온 곳(WISPLAT)과 "YOU ARE HERE"(WIURH) 를 깜빡이며 보여준다
 *  3. Finale 에피소드 엔딩: 바닥 무늬 위에 글자가 한 자씩 찍히고, 이어서 에피소드별 그림 (E3 은 토끼 스크롤)
 *  에피소드 4 는 지도 화면 없이 INTERPIC 배경에 점수만 보여준다.
 * 모두 320×200 화면 버퍼에 그린다. tick() 은 35Hz.
 */
import { SCREEN_W as W } from '../render/renderer.js';
import { t } from '../app/i18n.js';

const TICRATE = 35;
const SHOW_NEXT_DELAY = 4 * TICRATE;      // 다음 맵 화면을 보여주는 시간
const ANIM_PERIOD = Math.floor(TICRATE / 3);

/**
 * 에피소드별 자료 (원작 wi_stuff.c). 에피소드 4 는 지도 화면이 없어 INTERPIC 배경에 점수만, 기준 시간도 없다.
 *  pars  : M1~M9 기준 시간(초)
 *  nodes : 지도 위 맵 위치
 *  anims : 지도 배경 애니메이션 { x, y, frames, period, level } — level 이 있으면 "다음 맵이 그 번호일 때만" 나온다
 */
const always = (x, y, period = ANIM_PERIOD) => ({ x, y, frames: 3, period });
const onLevel = (x, y, level, frames = 1) => ({ x, y, frames, period: ANIM_PERIOD, level });
const EPISODES = [
  { // 1: Knee-Deep in the Dead
    pars: [30, 75, 120, 90, 165, 180, 180, 30, 165],
    nodes: [[185, 164], [148, 143], [69, 122], [209, 102], [116, 89], [166, 55], [71, 24], [135, 29], [71, 24]],
    anims: [[224, 104], [184, 160], [112, 136], [72, 112], [88, 96], [64, 48], [192, 40], [136, 16], [80, 16], [64, 24]].map(([x, y]) => always(x, y)),
  },
  { // 2: The Shores of Hell (지도 위에 다음 맵 쪽 건물이 하나씩 나타난다)
    pars: [90, 90, 90, 120, 90, 360, 240, 30, 170],
    nodes: [[254, 25], [97, 50], [188, 64], [128, 78], [214, 92], [133, 130], [208, 136], [148, 140], [235, 158]],
    anims: [1, 2, 3, 4, 5, 6, 7].map((n) => onLevel(128, 136, n)).concat([onLevel(192, 144, 8, 3), onLevel(128, 136, 8)]),
  },
  { // 3: Inferno
    pars: [90, 45, 90, 150, 90, 90, 165, 30, 135],
    nodes: [[156, 168], [48, 154], [174, 95], [265, 75], [130, 48], [279, 23], [198, 48], [140, 25], [281, 136]],
    anims: [always(104, 168), always(40, 136), always(160, 96), always(104, 80), always(120, 32), always(40, 0, Math.floor(TICRATE / 4))],
  },
  { pars: null, nodes: null, anims: [] },   // 4: Thy Flesh Consumed
];
const STATS_X = 50, STATS_Y = 50, TIME_X = 16, TIME_Y = 200 - 32, TITLE_Y = 2;

// 둠2 (원작 cpars): MAP01~32 기준 시간. 점수 화면은 지도 없이 INTERPIC 배경, 맵 이름은 CWILV00~31
const DOOM2 = {
  pars: [30, 90, 120, 120, 90, 150, 120, 120, 270, 90, 210, 150, 150, 150, 210, 150, 420, 150, 210, 150,
    240, 150, 180, 150, 150, 300, 330, 420, 300, 180, 120, 30],
  nodes: null, anims: [],
};

export const parTime = (map) => {
  const d2 = /^MAP(\d\d)$/.exec(map);
  if (d2) return DOOM2.pars[Number(d2[1]) - 1] ?? 0;
  const m = /^E(\d)M(\d)$/.exec(map);
  return m ? (EPISODES[Number(m[1]) - 1]?.pars?.[Number(m[2]) - 1] ?? 0) : 0;
};
const mapIndex = (map) => Number(/^E\dM(\d)$/.exec(map)?.[1] ?? /^MAP(\d\d)$/.exec(map)?.[1] ?? 1) - 1;
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
    this.commercial = /^MAP/.test(info.map);         // 둠2
    this.epsd = this.commercial ? 0 : Number(/^E(\d)/.exec(info.map)?.[1] ?? 1) - 1;
    this.ep = this.commercial ? DOOM2 : EPISODES[this.epsd] ?? EPISODES[3];
    this.background = !this.commercial && this.epsd <= 2 ? this.hud.patch(`WIMAP${this.epsd}`) : null;
    this.background ??= this.hud.patch('INTERPIC');
    // 다음 맵 화면: 둠1 E1~E3 은 지도 위에, 둠2 는 배경 위에 "ENTERING" 만
    this.hasMapScreen = this.next !== null && (this.commercial || (!!this.ep.nodes && !!this.hud.patch(`WIMAP${this.epsd}`)));
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
    this.anims = this.ep.anims.map((a) => ({ ...a, ctr: -1, next: a.level ? 1 : 1 + Math.floor(Math.random() * a.period) }));
    this.pointerOn = true;
  }

  /** 키/탭: 숫자를 끝까지 채우거나 다음 화면으로 */
  press() { this.accel = true; }

  tick() {
    this.bcnt++;
    this.anims.forEach((a, i) => {
      if (this.bcnt < a.next) return;
      if (!a.level) { a.ctr = (a.ctr + 1) % a.frames; a.next = this.bcnt + a.period; return; }
      // 다음 맵 자리의 그림만 (점수 화면에서는 8번째 것을 움직이지 않는다: 원작)
      if (this.next !== a.level ||(this.state === 'stats' && i === 7)) return;
      a.ctr = Math.min(a.ctr + 1, a.frames - 1);
      a.next = this.bcnt + a.period;
    });
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
    h.blit(frame, this.background, 0, 0);
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

  /** 맵 이름 그림 (둠1 WILV13 = E2M4, 둠2 CWILV03 = MAP04) */
  levelName(i) { return this.hud.patch(this.commercial ? `CWILV${String(i).padStart(2, '0')}` : `WILV${this.epsd}${i}`); }

  /** "E1M3" + "FINISHED!" */
  drawFinished(frame) {
    const h = this.hud, name = this.levelName(this.last), fin = h.patch('WIF');
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
    if (!this.ep.pars) return;                     // 에피소드 4 는 기준 시간이 없다
    h.blit(frame, h.patch('WIPAR'), W / 2 + TIME_X, TIME_Y);
    this.drawTime(frame, W - TIME_X, TIME_Y, c.par);
  }

  /** 지도 위에 지나온 곳 표시 */
  drawOnNode(frame, n, patches) {
    const [x, y] = this.ep.nodes[n];
    for (const p of patches) {
      if (!p) continue;
      const left = x - p.leftOffset, top = y - p.topOffset;
      if (left >= 0 && left + p.width < W && top >= 0 && top + p.height < 200) { this.hud.blit(frame, p, x, y); return; }
    }
  }

  drawNext(frame) {
    const h = this.hud;
    if (this.ep.nodes) {                                                 // 둠2 는 지도가 없다
      const last = this.last === 8 ? this.next - 1 : this.last;         // 비밀 맵에서 돌아올 때는 다음 맵 직전까지
      for (let i = 0; i <= last; i++) this.drawOnNode(frame, i, [h.patch('WISPLAT')]);
      if (this.last === 8) this.drawOnNode(frame, 8, [h.patch('WISPLAT')]);              // 비밀 맵을 거쳐 왔다
      if (this.pointerOn) this.drawOnNode(frame, this.next, [h.patch('WIURH0'), h.patch('WIURH1')]);
    }
    // "ENTERING" + 다음 맵 이름
    const enter = h.patch('WIENTER'), name = this.levelName(this.next);
    if (!enter || !name) return;
    h.blit(frame, enter, (W - enter.width) >> 1, TITLE_Y);
    h.blit(frame, name, (W - name.width) >> 1, TITLE_Y + Math.floor((5 * name.height) / 4));
  }
}

// ---------- 에피소드 엔딩 (원작 f_finale.c) ----------
const TEXT_SPEED = 3, TEXT_WAIT = 250;
/** 에피소드별 글 키 · 바닥 무늬 · 글 다음 그림 (E3 은 그림 대신 토끼 스크롤) */
const ENDINGS = [
  { text: 'finale.e1', flat: 'FLOOR4_8', pics: ['HELP2', 'CREDIT'] },   // 셰어웨어·정식판 = HELP2, 얼티밋 = CREDIT
  { text: 'finale.e2', flat: 'SFLR6_1', pics: ['VICTORY2'] },
  { text: 'finale.e3', flat: 'MFLR8_4', bunny: true },
  { text: 'finale.e4', flat: 'MFLR8_3', pics: ['ENDPIC'] },
];
// ---------- 둠2 이야기 화면 (원작 C1TEXT~C6TEXT) ----------
const DOOM2_STORIES = {
  C1: { flat: 'SLIME16', text: 'story.C1' },
  C2: { flat: 'RROCK14', text: 'story.C2' },
  C3: { flat: 'RROCK07', text: 'story.C3' },
  C4: { flat: 'RROCK17', cast: true, text: 'story.C4' },
  C5: { flat: 'RROCK13', text: 'story.C5' },
  C6: { flat: 'RROCK19', text: 'story.C6' },
};

// ---------- 둠2 출연진 소개 (원작 F_StartCast): 몬스터가 하나씩 걷고 공격하고, 키를 누르면 쓰러진다 ----------
const CAST = ['POSS', 'SPOS', 'CPOS', 'TROO', 'SARG', 'SKUL', 'HEAD', 'BOS2', 'BOSS', 'BSPI', 'PAIN', 'SKEL', 'FATT', 'VILE', 'SPID', 'CYBR', 'PLAY'];   // 이름은 t('cast.<스프라이트>')
const S = (f, t) => ({ f, t });
const PLAYER_CAST = {   // 플레이어는 상태 표가 states.js 에 없어 여기 둔다
  states: {
    run: [S('A', 4), S('B', 4), S('C', 4), S('D', 4)],
    attack: [S('E', 12), S('F', 6, true)],
    die: [S('H', 10), S('I', 10), S('J', 10), S('K', 10), S('L', 10), S('M', 10), S('N', -1)],
  },
  sounds: { see: null, die: 'PLDETH' },
};

// 토끼 스크롤 (원작 F_BunnyScroll): 230 tic 뒤부터 PFUB2 → PFUB1 로 2 tic 에 1픽셀, 1130 tic 에 "THE END" 가 한 글자씩
const BUNNY_SCROLL_AT = 230, BUNNY_END_AT = 1130, BUNNY_LETTERS_AT = 1180;
const textLength = (lines) => lines.join('\n').length;
const endText = (end) => t(end.text);

export class Finale {
  /**
   * @param play (효과음 이름) => void
   * @param castInfo (스프라이트 이름) => { states, sounds } — 출연진 소개에 쓰는 몬스터 상태 표 (states.js 의 AI)
   */
  constructor(hud, play = () => {}, castInfo = () => null) { this.hud = hud; this.play = play; this.castInfo = castInfo; this.done = false; }

  /** 둠1 에피소드 엔딩. epsd: 0 = 에피소드 1 … 3 = 에피소드 4 */
  start(epsd = 0) {
    this.end = ENDINGS[epsd] ?? ENDINGS[0];
    this.story = null;
    this.song = 'D_VICTOR';
    this.begin();
  }

  /** 둠2 이야기 화면 (C1~C6). C4(MAP30 끝) 다음에는 출연진 소개 */
  startStory(key) {
    this.end = DOOM2_STORIES[key];
    this.story = key;
    this.song = 'D_READ_M';
    this.begin();
  }

  begin() {
    this.typed = textLength(endText(this.end)) * TEXT_SPEED + 10;
    this.count = 0; this.stage = 0; this.done = false; this.endLetters = -1;
  }

  /** 글자가 찍히는 중이면 한 번에 다 보여주고, 다 보였으면 다음 화면으로, 마지막 화면이면 끝 */
  press() {
    if (this.stage === 0) { if (this.count < this.typed) this.count = this.typed; else this.toArt(); }
    else if (this.stage === 2) this.castPress();
    else this.done = true;
  }

  /** 글이 끝난 다음: 그림(둠1) · 출연진 소개(MAP30) · 바로 끝(그 밖의 둠2 이야기) */
  toArt() {
    if (this.end.cast) { this.startCast(); return; }
    if (this.story) { this.done = true; return; }
    this.stage = 1; this.count = 0;
  }

  tick() {
    this.count++;
    if (this.stage === 0 && this.count > this.typed - 10 + TEXT_WAIT) this.toArt();
    else if (this.stage === 2) this.castTick();
  }

  // ---------- 출연진 소개 ----------
  startCast() {
    this.stage = 2; this.song = 'D_EVIL';
    this.castNum = 0; this.castSetup();
  }

  castSetup() {
    const sprite = CAST[this.castNum], name = t(`cast.${sprite}`);
    this.cast = { sprite, name, info: sprite === 'PLAY' ? PLAYER_CAST : this.castInfo(sprite) };
    this.castDeath = false; this.castFrames = 0; this.castAttacking = false;
    this.castSet('run', 0);
    const see = this.cast.info?.sounds?.see;
    if (see) this.play(Array.isArray(see) ? see[0] : see);
  }

  castSet(label, idx) {
    const list = this.cast.info?.states?.[label] ?? [S('A', -1)];
    const s = list[idx] ?? list[0];
    this.castLabel = label; this.castIdx = idx; this.castFrame = s.f; this.castTics = s.t;
  }

  castTick() {
    if (this.castTics === -1) {                             // 다 쓰러졌다: 잠깐 뒤 다음 출연자
      if (this.castDeath && ++this.castFrames > 15) { this.castNum = (this.castNum + 1) % CAST.length; this.castSetup(); }
      return;
    }
    if (--this.castTics > 0) return;
    const list = this.cast.info?.states?.[this.castLabel] ?? [];
    if (this.castIdx + 1 < list.length) { this.castSet(this.castLabel, this.castIdx + 1); return; }
    if (this.castDeath) { this.castTics = -1; return; }
    // 걷기를 12 번 하면 공격을 한 번 보여 주고 다시 걷는다 (원작과 같은 리듬)
    if (this.castLabel === 'run' && ++this.castFrames >= 12 && this.cast.info?.states?.attack) { this.castFrames = 0; this.castSet('attack', 0); return; }
    this.castSet('run', 0);
  }

  castPress() {
    if (this.castDeath) return;
    this.castDeath = true; this.castFrames = 0;
    this.castSet('die', 0);
    const die = this.cast.info?.sounds?.die;
    if (die) this.play(Array.isArray(die) ? die[0] : die);
  }

  drawCast(frame) {
    const h = this.hud;
    h.blit(frame, h.patch('BOSSBACK'), 0, 0);
    const { sprite, name } = this.cast, f = this.castFrame;
    const pic = h.patch(`${sprite}${f}1`) ?? h.patch(`${sprite}${f}0`) ?? h.patch(`${sprite}${f}1${f}9`);
    h.blit(frame, pic, W / 2, 170);
    h.text(frame, name, (W - h.textWidth(name)) >> 1, 180);
  }

  draw(frame) {
    const h = this.hud;
    if (this.stage === 2) { this.drawCast(frame); return; }
    if (this.stage === 1) {
      if (this.end.bunny) this.drawBunny(frame);
      else h.blit(frame, this.end.pics.map((n) => h.patch(n)).find(Boolean), 0, 0);
      return;
    }
    h.drawFlat(frame, this.end.flat);
    let left = Math.max(0, Math.floor((this.count - 10) / TEXT_SPEED));
    endText(this.end).forEach((line, i) => {
      if (left <= 0) return;
      h.text(frame, line.slice(0, left), 10, 10 + 11 * i);
      left -= line.length + 1;
    });
  }

  drawBunny(frame) {
    const h = this.hud, c = this.count;
    const scrolled = Math.max(0, Math.min(W, W - Math.floor((c - BUNNY_SCROLL_AT) / 2)));
    frame.fill(0xff000000);
    h.blit(frame, h.patch('PFUB2'), -scrolled, 0, 0, 200, true);
    h.blit(frame, h.patch('PFUB1'), W - scrolled, 0, 0, 200, true);
    if (c < BUNNY_END_AT) return;
    const x = (W - 13 * 8) >> 1, y = (200 - 8 * 8) >> 1;
    if (c < BUNNY_LETTERS_AT) { h.blit(frame, h.patch('END0'), x, y); return; }
    const n = Math.min(6, Math.floor((c - BUNNY_LETTERS_AT) / 5));
    if (n > this.endLetters) { this.endLetters = n; this.play('PISTOL'); }
    h.blit(frame, h.patch(`END${n}`), x, y);
  }
}

/**
 * 타이틀 화면과 메뉴 (원작 m_menu.c 의 좌표와 그래픽을 쓴다. 320×200 화면 좌표).
 * 상태: title → main(이어하기/새 게임/옵션/불러오기/저장/도움말/종료) → skill | options → sound | cheats | load | save | confirm | help → closed(게임 중)
 *
 * 각 상태는 layout() 이 항목 목록을 만들고, 키·마우스·터치·그리기가 모두 그 목록을 쓴다.
 *   항목 = { id, patch | text, x, y, h, act(), adjust(dir), therm: { get, set, max }, ... }
 * 모든 하위 메뉴에는 왼쪽 위에 BACK 버튼이 있다 (Esc 와 같음 — 터치에는 Esc 가 없다).
 */
const SKILLS = ['M_JKILL', 'M_ROUGH', 'M_HURT', 'M_ULTRA', 'M_NMARE'];
const POWERS = [
  { id: 'invuln', label: 'INVULNERABILITY' }, { id: 'berserk', label: 'BERSERK' }, { id: 'invis', label: 'INVISIBILITY' },
  { id: 'radsuit', label: 'RADIATION SUIT' }, { id: 'automap', label: 'COMPUTER MAP' }, { id: 'lightamp', label: 'LIGHT AMP' },
];
// 저장/불러오기 목록: 슬롯 0 = 자동 저장(불러오기에만), 1~ = 수동 저장 (원작 LoadDef: x=80, y=54, 줄 간격 16)
const SLOT_X = 80, SLOT_Y = 54, SLOT_H = 16, SLOT_CELLS = 24;
const LOAD_SLOTS = [0, 1, 2, 3, 4, 5], SAVE_SLOTS = [1, 2, 3, 4, 5];
const BACK_W = 62, BACK_H = 20;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Menu {
  /**
   * @param actions { maps(), currentMap(), warp(name), hasGame(), hasAuto(), canSave(), newGame(skill), slotNames(), loadSlot(n), saveSlot(n),
   *   quitToTitle(), settingsChanged(), play(soundName), resume(), cheat(name, arg), cheatInfo() }
   */
  constructor(hud, actions, settings) {
    this.hud = hud;
    this.actions = actions;
    this.settings = settings;          // { sfx 0..15, music 0..15, sens 0..9, skill 1..5, messages 0/1, screenSize 3..11, gamma 0..4 }
    this.state = 'title';
    this.cursor = 0;
    this.mapIdx = 0;                   // 옵션 메뉴에서 고른 맵 (actions.maps() 의 번호)
    this.power = 0;                    // 치트 메뉴에서 고른 파워업
    this.confirm = null;               // { lines, yes(), back: [상태, 커서] }
    this.helpPage = 0; this.helpFrom = 'closed';
  }

  get open() { return this.state !== 'closed'; }

  /** cursor: 번호 또는 항목 id */
  show(state, cursor = 0) {
    this.state = state;
    this.cursor = 0;
    if (typeof cursor === 'string') this.cursor = Math.max(0, this.layout().items.findIndex((it) => it.id === cursor));
    else this.cursor = cursor;
  }
  close() { this.state = 'closed'; }

  /** 게임으로 돌아간다 (포인터 잠금 등은 화면 쪽이 처리) */
  resume() { this.close(); this.actions.resume?.(); }

  /** 확인 창: 예 → yes(), 아니오/BACK → back 으로 */
  ask(lines, yes, back) {
    this.confirm = { lines, yes, back };
    this.show('confirm', 1);          // 기본 선택은 NO (실수로 누른 탭이 일을 내지 않게)
  }

  /** 도움말 (F1 / READ THIS!) */
  help(from = 'closed') { this.helpFrom = from; this.helpPage = 0; this.show('help'); }

  /** 한 단계 위로 (Esc, BACK 버튼) */
  back() {
    const a = this.actions;
    a.play('SWTCHX');
    switch (this.state) {
      case 'main': if (a.hasGame()) this.resume(); else this.show('title'); break;
      case 'skill':
        if (this.episode) this.show('episode', `ep${this.episode}`); else this.show('main', 'new');
        break;
      case 'episode': case 'options': this.show('main', this.state === 'episode' ? 'new' : 'options'); break;
      case 'sound': this.show('options', 'sound'); break;
      case 'cheats': this.show('options', 'cheats'); break;
      case 'load': this.show('main', 'load'); break;
      case 'save': this.show('main', 'save'); break;
      case 'confirm': if (this.confirm.back === 'close') this.resume(); else this.show(...this.confirm.back); break;
      case 'help': if (this.helpFrom === 'closed') this.resume(); else this.show(this.helpFrom, 'help'); break;
      default: break;
    }
  }

  // ---------- 항목 ----------
  /** 현재 상태의 항목들 */
  layout() {
    const a = this.actions, s = this.settings;
    const L = { items: [], skullX: 0, back: true, title: () => {} };
    const hud = this.hud, I = L.items;
    const set = (key, v, lo, hi) => { s[key] = clamp(v, lo, hi); a.play('STNMOV'); a.settingsChanged(); };

    switch (this.state) {
      case 'main': {
        L.back = false; L.skullX = 65;
        L.title = (f) => hud.blit(f, hud.patch('M_DOOM'), 94, 2);
        if (a.hasGame()) I.push({ id: 'resume', text: 'RESUME', act: () => { a.play('PISTOL'); this.resume(); } });
        else if (a.hasAuto?.()) I.push({ id: 'continue', text: 'CONTINUE', act: () => { if (a.loadSlot(0)) a.play('PISTOL'); else a.play('OOF'); } });
        I.push({ id: 'new', patch: 'M_NGAME', act: () => {
          a.play('PISTOL');
          this.episode = null;
          if ((a.episodes?.() ?? []).length > 1) this.show('episode'); else this.show('skill', clamp(s.skill - 1, 0, 4));   // 정식판: 에피소드부터 고른다
        } });
        I.push({ id: 'options', patch: 'M_OPTION', act: () => { a.play('PISTOL'); this.mapIdx = Math.max(0, a.maps().indexOf(a.currentMap())); this.show('options'); } });
        I.push({ id: 'load', patch: 'M_LOADG', act: () => { a.play('PISTOL'); this.show('load'); } });
        I.push({ id: 'save', patch: 'M_SAVEG', act: () => { if (a.canSave()) { a.play('PISTOL'); this.show('save'); } else a.play('OOF'); } });
        I.push({ id: 'help', patch: 'M_RDTHIS', act: () => { a.play('PISTOL'); this.help('main'); } });
        I.push({ id: 'quit', patch: 'M_QUITG', act: () => {
          a.play('PISTOL');
          if (a.hasGame()) this.ask(['QUIT TO THE TITLE SCREEN?', 'UNSAVED PROGRESS WILL BE LOST.'], () => a.quitToTitle(), ['main', 'quit']);
          else this.show('title');
        } });
        I.forEach((it, i) => Object.assign(it, { x: 97, y: 56 + 16 * i, h: 16, rx0: 80, rx1: 250 }));
        break;
      }
      case 'episode': {
        L.skullX = 16;
        L.title = (f) => hud.blit(f, hud.patch('M_EPISOD'), 54, 38);
        a.episodes().forEach((ep, i) => I.push({
          id: `ep${ep}`, patch: `M_EPI${ep}`, x: 48, y: 63 + 16 * i, h: 16, rx0: 40, rx1: 290,
          act: () => { a.play('PISTOL'); this.episode = ep; this.show('skill', clamp(s.skill - 1, 0, 4)); },
        }));
        break;
      }
      case 'skill': {
        L.skullX = 16;
        L.title = (f) => { hud.blit(f, hud.patch('M_NEWG'), 96, 14); hud.blit(f, hud.patch('M_SKILL'), 54, 38); };
        SKILLS.forEach((patch, i) => I.push({
          id: `skill${i}`, patch, x: 48, y: 63 + 16 * i, h: 16, rx0: 40, rx1: 270,
          act: () => {
            a.play('PISTOL');
            if (a.hasGame()) this.ask(['START A NEW GAME?', 'YOUR CURRENT PROGRESS WILL BE LOST.'], () => a.newGame(i + 1, this.episode), ['skill', i]);
            else a.newGame(i + 1, this.episode);
          },
        }));
        break;
      }
      case 'options': {
        L.skullX = 28;
        L.title = (f) => {
          hud.blit(f, hud.patch('M_OPTTTL'), 108, 15);
          this.dim(f, 56, 148, 256, 200);                 // 타이틀 그림 위에서도 글자가 읽히게
        };
        const maps = a.maps();
        I.push({ id: 'end', patch: 'M_ENDGAM', x: 60, y: 37, h: 16, act: () => {
          if (!a.hasGame()) { a.play('OOF'); return; }
          a.play('PISTOL');
          this.ask(['ARE YOU SURE YOU WANT TO', 'END THE GAME?'], () => a.quitToTitle(), ['options', 'end']);
        } });
        const toggleMsg = () => set('messages', s.messages ? 0 : 1, 0, 1);
        I.push({ id: 'msg', patch: 'M_MESSG', x: 60, y: 53, h: 16, extra: [s.messages ? 'M_MSGON' : 'M_MSGOFF', 180], adjust: toggleMsg, act: toggleMsg });
        I.push({ id: 'size', patch: 'M_SCRNSZ', x: 60, y: 69, h: 32, therm: { get: () => s.screenSize - 3, set: (v) => set('screenSize', v + 3, 3, 11), max: 8 } });
        I.push({ id: 'sens', patch: 'M_MSENS', x: 60, y: 101, h: 32, therm: { get: () => s.sens, set: (v) => set('sens', v, 0, 9), max: 9 } });
        I.push({ id: 'sound', patch: 'M_SVOL', x: 60, y: 133, h: 16, act: () => { a.play('PISTOL'); this.show('sound'); } });
        const gamma = (d) => set('gamma', (s.gamma + d + 5) % 5, 0, 4);
        I.push({ id: 'bright', text: `BRIGHTNESS  < ${s.gamma} >`, x: 64, y: 150, h: 10, adjust: gamma, act: () => gamma(1) });
        I.push({ id: 'cheats', text: 'CHEATS', x: 64, y: 160, h: 10, act: () => { a.play('PISTOL'); this.show('cheats'); } });
        const cycleMap = (d) => { const n = maps.length; if (n) { this.mapIdx = (this.mapIdx + d + n) % n; a.play('STNMOV'); } };
        I.push({ id: 'map', text: `MAP  < ${maps[this.mapIdx] ?? '-'} >`, x: 64, y: 170, h: 10, adjust: cycleMap, act: () => cycleMap(1) });
        I.push({ id: 'warp', text: 'START MAP', x: 64, y: 180, h: 10, act: () => this.warpToMap() });
        I.push({ id: 'wad', text: 'CHANGE WAD FILE', x: 64, y: 190, h: 10, act: () => {
          a.play('PISTOL');
          this.ask(['CHANGE THE WAD FILE?', 'UNSAVED PROGRESS WILL BE LOST.'], () => a.changeWad(), ['options', 'wad']);
        } });
        I.forEach((it) => Object.assign(it, { rx0: 56, rx1: 270 }));
        break;
      }
      case 'sound': {
        L.skullX = 48;
        L.title = (f) => hud.blit(f, hud.patch('M_SVOL'), 60, 38);
        I.push({ id: 'sfx', patch: 'M_SFXVOL', x: 80, y: 64, h: 32, therm: { get: () => s.sfx, set: (v) => set('sfx', v, 0, 15), max: 15 } });
        I.push({ id: 'music', patch: 'M_MUSVOL', x: 80, y: 96, h: 32, therm: { get: () => s.music, set: (v) => set('music', v, 0, 15), max: 15 } });
        I.forEach((it) => Object.assign(it, { rx0: 60, rx1: 280 }));
        break;
      }
      case 'cheats': {
        L.skullX = 28;
        L.title = (f) => { this.dim(f, 50, 14, 270, 150); this.hud.text(f, 'CHEATS', 160 - hud.textWidth('CHEATS') / 2, 20); };
        const c = a.cheatInfo?.() ?? {};
        const onOff = (b) => (b ? 'ON' : 'OFF');
        const cheat = (name, arg) => () => { if (!a.hasGame()) { a.play('OOF'); return; } a.cheat(name, arg); a.play('SWTCHN'); };
        const power = (d) => { this.power = (this.power + d + POWERS.length) % POWERS.length; a.play('STNMOV'); };
        I.push({ id: 'god', text: `GOD MODE  ${onOff(c.god)}`, act: cheat('god') });
        I.push({ id: 'noclip', text: `NO CLIPPING  ${onOff(c.noclip)}`, act: cheat('noclip') });
        I.push({ id: 'kfa', text: 'ALL WEAPONS, AMMO, KEYS', act: cheat('kfa') });
        I.push({ id: 'fa', text: 'ALL WEAPONS, AMMO (NO KEYS)', act: cheat('fa') });
        I.push({ id: 'map', text: `AUTOMAP  ${['OFF', 'ALL LINES', 'LINES + THINGS'][c.automap ?? 0]}`, act: cheat('map') });
        I.push({ id: 'power', text: `POWER-UP  < ${POWERS[this.power].label} >`, adjust: power, act: () => power(1) });
        I.push({ id: 'give', text: 'GIVE THE POWER-UP', act: cheat('power', POWERS[this.power].id) });
        I.forEach((it, i) => Object.assign(it, { x: 64, y: 40 + 15 * i, h: 14, rx0: 50, rx1: 270 }));
        break;
      }
      case 'load': case 'save': {
        L.skullX = SLOT_X - 32;
        L.title = (f) => {
          hud.blit(f, hud.patch(this.state === 'load' ? 'M_LOADG' : 'M_SAVEG'), 72, 28);
          const names = a.slotNames();
          this.slotList().forEach((slot, i) => {
            const y = SLOT_Y + SLOT_H * i;
            this.slotBorder(f, SLOT_X, y + 7);          // 원작처럼 테두리는 글자보다 7 아래에 그린다
            hud.text(f, names[slot] ?? 'EMPTY SLOT', SLOT_X, y);
          });
        };
        this.slotList().forEach((slot, i) => I.push({
          id: `slot${slot}`, x: SLOT_X, y: SLOT_Y + SLOT_H * i, h: SLOT_H, rx0: SLOT_X - 8, rx1: SLOT_X + 200, hidden: true,
          act: () => this.chooseSlot(slot),
        }));
        break;
      }
      case 'confirm': {
        L.skullX = 0;
        const lines = this.confirm?.lines ?? [];
        L.title = (f) => {
          this.dim(f, 20, 56, 300, 150);
          lines.forEach((line, i) => hud.text(f, line, 160 - hud.textWidth(line) / 2, 66 + 11 * i));
        };
        I.push({ id: 'yes', text: 'YES', x: 118, y: 124, h: 14, rx0: 96, rx1: 156, skullX: 94, act: () => { this.actions.play('PISTOL'); this.confirm.yes(); } });
        I.push({ id: 'no', text: 'NO', x: 196, y: 124, h: 14, rx0: 176, rx1: 236, skullX: 172, act: () => this.back() });
        break;
      }
      default: break;
    }
    return L;
  }

  slotList() { return this.state === 'save' ? SAVE_SLOTS : LOAD_SLOTS; }

  /** 슬롯으로 불러오기/저장 */
  chooseSlot(slot) {
    const a = this.actions;
    if (this.state === 'load') { if (!a.loadSlot(slot)) a.play('OOF'); else a.play('PISTOL'); }
    else if (!a.saveSlot(slot)) a.play('OOF');
    else a.play('SWTCHN');
  }

  /** 고른 맵을 처음부터 시작 (게임 중이든 타이틀이든) */
  warpToMap() {
    const name = this.actions.maps()[this.mapIdx];
    if (!name) { this.actions.play('OOF'); return; }
    this.actions.play('PISTOL');
    this.actions.warp(name);
  }

  // ---------- 입력 ----------
  /** 키 입력 처리. 처리했으면 true (게임으로 전달하지 않음) */
  key(code) {
    const up = code === 'ArrowUp' || code === 'KeyW', down = code === 'ArrowDown' || code === 'KeyS';
    const left = code === 'ArrowLeft' || code === 'KeyA', right = code === 'ArrowRight' || code === 'KeyD';
    const enter = code === 'Enter' || code === 'Space' || code === 'NumpadEnter';

    if (this.state === 'title') {
      this.actions.play('SWTCHN');
      this.show('main');
      return true;
    }
    if (this.state === 'help') {
      if (code === 'Escape') { this.back(); return true; }
      this.advanceHelp();
      return true;
    }
    if (this.state === 'confirm') {
      if (code === 'KeyY') { this.actions.play('PISTOL'); this.confirm.yes(); return true; }
      if (code === 'KeyN' || code === 'Escape') { this.back(); return true; }
    }
    if (code === 'Escape') { this.back(); return true; }

    const items = this.layout().items, it = items[this.cursor];
    if (up || down) { this.cursor = (this.cursor + (up ? -1 : 1) + items.length) % items.length; this.actions.play('PSTOP'); return true; }
    if (this.state === 'confirm' && (left || right)) { this.cursor = 1 - this.cursor; this.actions.play('PSTOP'); return true; }
    if ((left || right) && it?.therm) { it.therm.set(clamp(it.therm.get() + (left ? -1 : 1), 0, it.therm.max)); return true; }
    if ((left || right) && it?.adjust) { it.adjust(left ? -1 : 1); return true; }
    if (enter && it?.act) { it.act(); return true; }
    return true;
  }

  advanceHelp() {
    this.actions.play('SWTCHN');
    if (this.helpPage === 0) this.helpPage = 1; else this.back();
  }

  /** 마우스/터치: (x, y)는 320×200 화면 좌표. click 이면 선택까지 */
  pointer(x, y, click) {
    if (this.state === 'title') { if (click) this.key('Enter'); return; }
    if (this.state === 'help') { if (click) this.advanceHelp(); return; }
    const L = this.layout();
    if (L.back && x < BACK_W && y < BACK_H) { if (click) this.back(); return; }
    const i = L.items.findIndex((it) => x >= it.rx0 && x <= it.rx1 && y >= it.y && y < it.y + it.h);
    if (i < 0) return;
    if (this.cursor !== i) { this.cursor = i; this.actions.play('PSTOP'); }
    if (!click) return;
    const it = L.items[i];
    if (it.therm) {                                                   // 온도계 막대를 직접 눌러 값 지정
      if (y - it.y > 14) it.therm.set(clamp(Math.round((x - it.x - 8) / 8), 0, it.therm.max));
    } else it.act?.();
  }

  // ---------- 그리기 ----------
  draw(frame, time) {
    const h = this.hud, p = (n) => h.patch(n);
    if (this.state === 'closed') return;
    if (this.state === 'help') { h.blit(frame, p(this.helpPage ? 'HELP2' : 'HELP1'), 0, 0); return; }

    // 게임이 없을 때는 타이틀 그림이 배경
    if (!this.actions.hasGame() || this.state === 'title') h.blit(frame, p('TITLEPIC'), 0, 0);

    if (this.state === 'title') {
      const msg = 'PRESS ANY KEY';
      if (Math.floor(time / 500) % 2 === 0) h.text(frame, msg, 160 - h.textWidth(msg) / 2, 184);
      return;
    }

    const L = this.layout();
    L.title(frame);
    const skull = p(Math.floor(time / 250) % 2 ? 'M_SKULL2' : 'M_SKULL1');
    L.items.forEach((it, i) => {
      if (it.patch) h.blit(frame, p(it.patch), it.x, it.y);
      else if (it.text) h.text(frame, it.text, it.x, it.y + (it.h >= 16 ? 4 : 0));
      if (it.extra) h.blit(frame, p(it.extra[0]), it.extra[1], it.y);
      if (it.therm) this.thermometer(frame, it.x, it.y + 16, it.therm.max + 1, it.therm.get());
      if (i === this.cursor) h.blit(frame, skull, it.skullX ?? L.skullX, it.y - (it.h >= 16 ? 5 : 4));
    });
    if (L.back) {
      this.dim(frame, 2, 3, BACK_W - 4, BACK_H - 3);
      h.text(frame, '< BACK', 7, 7);
    }
  }

  /** 사각형 영역을 어둡게 (글자 뒤 배경) */
  dim(frame, x0, y0, x1, y1) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * 320 + x; frame[i] = ((frame[i] >> 2) & 0x3f3f3f) | 0xff000000; }
  }

  /** 슬롯 한 줄의 테두리 (원작 M_DrawSaveLoadBorder) */
  slotBorder(frame, x, y) {
    const h = this.hud;
    h.blit(frame, h.patch('M_LSLEFT'), x - 8, y);
    for (let i = 0; i < SLOT_CELLS; i++) h.blit(frame, h.patch('M_LSCNTR'), x + i * 8, y);
    h.blit(frame, h.patch('M_LSRGHT'), x + SLOT_CELLS * 8, y);
  }

  /** 슬라이더 (원작 M_DrawThermo): 왼쪽 끝 + 가운데 칸들 + 오른쪽 끝 + 현재 값 표시 */
  thermometer(frame, x, y, width, value) {
    const h = this.hud;
    h.blit(frame, h.patch('M_THERML'), x, y);
    let xx = x + 8;
    for (let i = 0; i < width; i++) { h.blit(frame, h.patch('M_THERMM'), xx, y); xx += 8; }
    h.blit(frame, h.patch('M_THERMR'), xx, y);
    h.blit(frame, h.patch('M_THERMO'), x + 8 + value * 8, y);
  }
}

/**
 * 타이틀 화면과 메뉴 (원작 m_menu.c 의 좌표와 그래픽을 그대로 쓴다. 320×200 화면 좌표).
 * 상태: title(타이틀) → main(새 게임/옵션/불러오기/저장/종료) → skill(난이도) | options(소리·마우스) | load | save → closed(게임 중)
 */
const SKILLS = ['M_JKILL', 'M_ROUGH', 'M_HURT', 'M_ULTRA', 'M_NMARE'];
const MAIN_ITEMS = [{ patch: 'M_NGAME', id: 'new' }, { patch: 'M_OPTION', id: 'options' }, { patch: 'M_LOADG', id: 'load' }, { patch: 'M_SAVEG', id: 'save' }, { patch: 'M_QUITG', id: 'quit' }];
const OPTION_ROWS = [
  { patch: 'M_SFXVOL', key: 'sfx', max: 15 },
  { patch: 'M_MUSVOL', key: 'music', max: 15 },
  { patch: 'M_MSENS', key: 'sens', max: 9 },
];
const THERM_X = 80;
// 저장/불러오기 목록: 슬롯 0 = 자동 저장(불러오기에만), 1~ = 수동 저장 (원작 LoadDef: x=80, y=54, 줄 간격 16)
const SLOT_X = 80, SLOT_Y = 54, SLOT_H = 16, SLOT_CELLS = 24;
const LOAD_SLOTS = [0, 1, 2, 3, 4, 5], SAVE_SLOTS = [1, 2, 3, 4, 5];

export class Menu {
  /**
   * @param actions { hasGame(), canSave(), newGame(skill), slotNames(), loadSlot(n), saveSlot(n), quitToTitle(), settingsChanged(), play(soundName) }
   */
  constructor(hud, actions, settings) {
    this.hud = hud;
    this.actions = actions;
    this.settings = settings;          // { sfx 0..15, music 0..15, sens 0..9, skill 1..5 }
    this.state = 'title';
    this.cursor = 0;
  }

  get open() { return this.state !== 'closed'; }

  show(state, cursor = 0) { this.state = state; this.cursor = cursor; }
  close() { this.state = 'closed'; }

  // ---------- 입력 ----------
  /** 키 입력 처리. 처리했으면 true (게임으로 전달하지 않음) */
  key(code) {
    const up = code === 'ArrowUp' || code === 'KeyW', down = code === 'ArrowDown' || code === 'KeyS';
    const enter = code === 'Enter' || code === 'Space' || code === 'NumpadEnter';

    switch (this.state) {
      case 'title':
        this.actions.play('SWTCHN');
        this.show('main');
        return true;
      case 'main':
        if (up || down) { this.move(up ? -1 : 1, MAIN_ITEMS.length); return true; }
        if (enter) { this.chooseMain(); return true; }
        if (code === 'Escape') { this.actions.play('SWTCHX'); this.actions.hasGame() ? this.close() : this.show('title'); return true; }
        return true;
      case 'skill':
        if (up || down) { this.move(up ? -1 : 1, SKILLS.length); return true; }
        if (enter) { this.actions.play('PISTOL'); this.actions.newGame(this.cursor + 1); return true; }
        if (code === 'Escape') { this.actions.play('SWTCHX'); this.show('main'); return true; }
        return true;
      case 'load': case 'save': {
        const slots = this.slotList();
        if (up || down) { this.move(up ? -1 : 1, slots.length); return true; }
        if (enter) { this.chooseSlot(); return true; }
        if (code === 'Escape') { this.actions.play('SWTCHX'); this.show('main', this.state === 'load' ? 2 : 3); return true; }
        return true;
      }
      case 'options':
        if (up || down) { this.move(up ? -1 : 1, OPTION_ROWS.length); return true; }
        if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD') {
          this.adjust(this.cursor, code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1);
          return true;
        }
        if (code === 'Escape' || enter) { this.actions.play('SWTCHX'); this.show('main', 1); return true; }
        return true;
      default:
        return false;
    }
  }

  move(dir, n) {
    this.cursor = (this.cursor + dir + n) % n;
    this.actions.play('PSTOP');
  }

  chooseMain() {
    const id = MAIN_ITEMS[this.cursor].id;
    this.actions.play('PISTOL');
    if (id === 'new') this.show('skill', Math.max(0, Math.min(4, this.settings.skill - 1)));
    else if (id === 'options') this.show('options');
    else if (id === 'load') this.show('load');
    else if (id === 'save') { if (this.actions.canSave()) this.show('save'); else this.actions.play('OOF'); }
    else this.actions.quitToTitle();
  }

  slotList() { return this.state === 'save' ? SAVE_SLOTS : LOAD_SLOTS; }

  /** 커서가 가리키는 슬롯으로 불러오기/저장 */
  chooseSlot() {
    const slot = this.slotList()[this.cursor];
    if (this.state === 'load') { if (!this.actions.loadSlot(slot)) this.actions.play('OOF'); else this.actions.play('PISTOL'); }
    else if (!this.actions.saveSlot(slot)) this.actions.play('OOF');
    else this.actions.play('SWTCHN');
  }

  adjust(row, delta, absolute = null) {
    const r = OPTION_ROWS[row];
    const v = absolute ?? this.settings[r.key] + delta;
    this.settings[r.key] = Math.max(0, Math.min(r.max, v));
    this.actions.play('STNMOV');
    this.actions.settingsChanged();
  }

  /** 마우스/터치: (x, y)는 320×200 화면 좌표. click 이면 선택까지 */
  pointer(x, y, click) {
    if (this.state === 'title') { if (click) this.key('Enter'); return; }
    const rows = this.state === 'main' ? { y0: 64, h: 16, n: MAIN_ITEMS.length, x0: 90, x1: 240 }
      : this.state === 'skill' ? { y0: 63, h: 16, n: SKILLS.length, x0: 40, x1: 260 }
        : this.state === 'options' ? { y0: 38, h: 32, n: OPTION_ROWS.length, x0: 60, x1: 260 }
          : this.state === 'load' || this.state === 'save' ? { y0: SLOT_Y, h: SLOT_H, n: this.slotList().length, x0: SLOT_X - 8, x1: SLOT_X + 200 } : null;
    if (!rows || x < rows.x0 || x > rows.x1) return;
    const i = Math.floor((y - rows.y0) / rows.h);
    if (i < 0 || i >= rows.n) return;
    if (this.cursor !== i) { this.cursor = i; this.actions.play('PSTOP'); }
    if (!click) return;
    if (this.state === 'main') this.chooseMain();
    else if (this.state === 'load' || this.state === 'save') this.chooseSlot();
    else if (this.state === 'skill') { this.actions.play('PISTOL'); this.actions.newGame(i + 1); }
    else if (this.state === 'options') {
      // 온도계 막대를 직접 눌러 값 지정
      const max = OPTION_ROWS[i].max, v = Math.round((x - THERM_X - 8) / 8);
      if (y - rows.y0 - i * rows.h > 14) this.adjust(i, 0, Math.max(0, Math.min(max, v)));
    }
  }

  // ---------- 그리기 ----------
  draw(frame, time) {
    const h = this.hud, p = (n) => h.patch(n);
    if (this.state === 'closed') return;

    // 게임이 없을 때는 타이틀 그림이 배경
    if (!this.actions.hasGame() || this.state === 'title') h.blit(frame, p('TITLEPIC'), 0, 0);

    if (this.state === 'title') {
      const msg = 'PRESS ANY KEY';
      if (Math.floor(time / 500) % 2 === 0) h.text(frame, msg, 160 - h.textWidth(msg) / 2, 184);
      return;
    }

    const skull = p(Math.floor(time / 250) % 2 ? 'M_SKULL2' : 'M_SKULL1');
    if (this.state === 'main') {
      h.blit(frame, p('M_DOOM'), 94, 2);
      MAIN_ITEMS.forEach((it, i) => h.blit(frame, p(it.patch), 97, 64 + 16 * i));
      h.blit(frame, skull, 65, 64 + 16 * this.cursor - 5);
    } else if (this.state === 'skill') {
      h.blit(frame, p('M_NEWG'), 96, 14);
      h.blit(frame, p('M_SKILL'), 54, 38);
      SKILLS.forEach((n, i) => h.blit(frame, p(n), 48, 63 + 16 * i));
      h.blit(frame, skull, 16, 63 + 16 * this.cursor - 5);
    } else if (this.state === 'options') {
      h.blit(frame, p('M_OPTTTL'), 108, 15);
      OPTION_ROWS.forEach((r, i) => {
        const y = 38 + 32 * i;
        h.blit(frame, p(r.patch), THERM_X, y);
        this.thermometer(frame, THERM_X, y + 16, r.max + 1, this.settings[r.key]);
      });
      h.blit(frame, skull, THERM_X - 32, 38 + 32 * this.cursor - 5);
    } else if (this.state === 'load' || this.state === 'save') {
      h.blit(frame, p(this.state === 'load' ? 'M_LOADG' : 'M_SAVEG'), 72, 28);
      const names = this.actions.slotNames();
      this.slotList().forEach((slot, i) => {
        const y = SLOT_Y + SLOT_H * i;
        this.slotBorder(frame, SLOT_X, y + 7);          // 원작처럼 테두리는 글자보다 7 아래에 그린다
        h.text(frame, names[slot] ?? 'EMPTY SLOT', SLOT_X, y);
      });
      h.blit(frame, skull, SLOT_X - 32, SLOT_Y + SLOT_H * this.cursor - 5);
    }
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

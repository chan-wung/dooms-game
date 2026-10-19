import { SCREEN_W as W, SCREEN_H, VIEW_H, pspriteColormap, viewWindow } from '../render/renderer.js';
import { WEAPONS } from '../game/weapons.js';
import { normAngle } from '../game/util.js';
import { needsGlyph, measure, TEXT_SIZE, SMALL_SIZE } from './font.js';

/**
 * 화면 아래 상태바(체력·방어구·탄약·무기 칸·열쇠·얼굴)와 손에 든 무기 스프라이트.
 * 위치는 원작 st_stuff.c 의 좌표를 그대로 쓴다 (320×200 화면, 상태바는 y = 168 부터).
 */
const ST_Y = 168;
const WEAPON_SLOTS = ['pistol', 'shotgun', 'chaingun', 'rocketLauncher', 'plasmaGun', 'bfg']; // 번호 2~7
const AMMO_ORDER = ['clip', 'shell', 'cell', 'rocket'];


export class Hud {
  constructor(gfx, wad) {
    this.wad = wad;
    this.sprites = gfx.sprites;
    this.palette = gfx.palette;
    this.textures = gfx.textures;
    this.lit = gfx.palette.lit;
    this.cache = new Map();
    this.texts = [];                     // 한글 문구 (font.js)
  }

  setPalette(n) { this.lit = this.palette.litFor(n); }

  /** 64×64 flat 을 화면 전체에 타일처럼 깐다 (엔딩 화면 배경) */
  drawFlat(frame, name) {
    const flat = this.textures.flat(name), table = this.lit[0];
    for (let y = 0; y < SCREEN_H; y++) for (let x = 0; x < W; x++) frame[y * W + x] = table[flat[((y & 63) << 6) | (x & 63)]];
  }

  /** 이름으로 그래픽(패치) 얻기 (없으면 null) */
  patch(name) {
    let t = this.cache.get(name);
    if (t === undefined) {
      const i = this.wad.indexOf(name);
      t = i >= 0 ? this.sprites.tex(i) : null;
      this.cache.set(name, t);
    }
    return t;
  }

  /** 패치를 (x, y) 에 그린다 (원작 V_DrawPatch: 패치의 오프셋만큼 이동). clipH: 그릴 수 있는 아래쪽 한계 */
  blit(frame, tex, x, y, cmap = 0, clipH = 200, raw = false) {
    if (!tex) return;
    const table = this.lit[cmap], { width: w, height: h, data, mask } = tex;
    // raw = 이미 화면 좌표(오프셋 반영 끝)인 경우
    const x0 = Math.round(raw ? x : x - tex.leftOffset), y0 = Math.round(raw ? y : y - tex.topOffset);
    for (let c = 0; c < w; c++) {
      const sx = x0 + c;
      if (sx < 0 || sx >= W) continue;
      for (let r = 0; r < h; r++) {
        const sy = y0 + r;
        if (sy < 0 || sy >= clipH) continue;
        if (mask[c * h + r]) frame[sy * W + sx] = table[data[c * h + r]];
      }
    }
  }

  /** 원작 글꼴(STCFN)로 글자 쓰기. 대문자만 지원, 소문자는 대문자로 바꿔 그린다. 한글 등은 갈무리 글꼴로 그린다 */
  text(frame, str, x, y, small = false) {
    if (needsGlyph(str)) {                       // 한글 등은 버퍼에 찍지 않고 겹침 캔버스(TextLayer)가 그린다
      const size = small ? SMALL_SIZE : TEXT_SIZE;
      this.texts.push({ str, x, y, size });
      return x + measure(str, size);
    }
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const code = ch.charCodeAt(0);
      const tex = code >= 33 && code <= 95 ? this.patch(`STCFN${String(code).padStart(3, '0')}`) : null;
      if (tex) { this.blit(frame, tex, cx, y); cx += tex.width; } else cx += 4;
    }
    return cx;
  }

  /** 글자 폭 (가운데 정렬용) */
  textWidth(str, small = false) {
    if (needsGlyph(str)) return measure(str, small ? SMALL_SIZE : TEXT_SIZE);
    let w = 0;
    for (const ch of str.toUpperCase()) {
      const code = ch.charCodeAt(0);
      const tex = code >= 33 && code <= 95 ? this.patch(`STCFN${String(code).padStart(3, '0')}`) : null;
      w += tex ? tex.width : 4;
    }
    return w;
  }

  /** 이번 프레임에 모인 한글 문구를 꺼낸다 (TextLayer 가 그린다) */
  takeTexts() { const t = this.texts; this.texts = []; return t; }

  // ---------- 손에 든 무기 ----------
  /** win: 3D 뷰 창 ({x, y, w, h}). 창이 좁으면 무기 그림도 같은 비율로 줄어든다 (원작 pspritescale) */
  drawWeapon(frame, game, view, win = viewWindow(10)) {
    const p = game.player;
    const def = WEAPONS[p.readyWeapon];
    if (!def) return;
    const ps = p.psp.weapon;
    const lightCmap = view.colormap ?? pspriteColormap(p.sector.light, p.extraLight);
    const scale = win.w / W;
    const place = (spriteName, frameIdx, bright) => {
      const f = this.sprites.frame(spriteName, frameIdx);
      if (!f) return;
      const tex = this.sprites.tex(f.rot[0].lump);
      // 원작: 화면 가운데(x=160) 기준, 세로는 BASEYCENTER(100) 기준이라 3D 뷰가 168줄일 때 16줄 위로 올라온다
      const x = win.x + win.w / 2 + (ps.sx - W / 2 - tex.leftOffset) * scale;
      const y = win.y + win.h / 2 - (100 + 0.5 - (ps.sy - tex.topOffset)) * scale;
      this.blitScaled(frame, tex, x, y, scale, bright ? 0 : lightCmap, win);
    };
    place(def.sprite, ps.frame, ps.bright);
    const fl = p.psp.flash;
    if (fl && def.flashSprite) place(def.flashSprite, fl.frame, true); // 총구 화염은 항상 최대 밝기
  }

  /** 패치를 scale 배로 (x, y 는 화면 좌표, 오프셋 반영 끝) 그린다. 3D 뷰 창 밖은 자른다 */
  blitScaled(frame, tex, x, y, scale, cmap, win) {
    const table = this.lit[cmap], { width: w, height: h, data, mask } = tex;
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w * scale), y1 = Math.round(y + h * scale);
    const inv = 1 / scale;
    for (let sx = Math.max(x0, win.x); sx < Math.min(x1, win.x + win.w); sx++) {
      const c = Math.min(w - 1, Math.floor((sx - x0) * inv));
      for (let sy = Math.max(y0, win.y); sy < Math.min(y1, win.y + win.h); sy++) {
        const r = Math.min(h - 1, Math.floor((sy - y0) * inv));
        if (mask[c * h + r]) frame[sy * W + sx] = table[data[c * h + r]];
      }
    }
  }

  /** 3D 뷰가 화면보다 작을 때의 바깥 테두리 (원작 R_FillBackScreen / R_DrawViewBorder) */
  drawBorder(frame, win) {
    if (win.w === W && win.y === 0) return;
    const flat = this.textures.flat('FLOOR7_2'), table = this.lit[0];
    const { x, y, w, h } = win;
    for (let py = 0; py < VIEW_H; py++) {
      const inside = py >= y && py < y + h;
      for (let px = 0; px < W; px++) {
        if (inside && px >= x && px < x + w) { px = x + w - 1; continue; }   // 3D 뷰가 그려진 곳은 건드리지 않는다
        frame[py * W + px] = table[flat[((py & 63) << 6) | (px & 63)]];
      }
    }
    const b = (name, bx, by) => this.blit(frame, this.patch(name), bx, by, 0, 200, true);
    for (let i = 0; i < w; i += 8) { b('BRDR_T', x + i, y - 8); b('BRDR_B', x + i, y + h); }
    for (let j = 0; j < h; j += 8) { b('BRDR_L', x - 8, y + j); b('BRDR_R', x + w, y + j); }
    b('BRDR_TL', x - 8, y - 8); b('BRDR_TR', x + w, y - 8); b('BRDR_BL', x - 8, y + h); b('BRDR_BR', x + w, y + h);
  }

  // ---------- 상태바 ----------
  /** 숫자를 오른쪽 끝 x 에 맞춰 그린다. font: 'STTNUM'(크고 빨강) | 'STYSNUM'(작고 노랑) */
  number(frame, value, rightX, y, font, width = 3) {
    const digits = String(Math.max(0, Math.floor(value))).slice(-width);
    const zero = this.patch(`${font}0`);
    if (!zero) return;
    let x = rightX;
    for (let i = digits.length - 1; i >= 0; i--) {
      x -= zero.width;
      this.blit(frame, this.patch(`${font}${digits[i]}`), x, y);
    }
  }

  drawStatusBar(frame, game) {
    const p = game.player;
    this.blit(frame, this.patch('STBAR'), 0, ST_Y);
    this.blit(frame, this.patch('STARMS'), 104, ST_Y);
    this.blit(frame, this.patch('STFB0'), 143, 169);

    // 현재 무기의 탄약 (주먹/전기톱은 표시 없음)
    const ammoType = WEAPONS[p.readyWeapon]?.ammo;
    if (ammoType) this.number(frame, p.ammo[ammoType], 44, 171, 'STTNUM');

    // 체력 / 방어구 (% 기호 포함)
    this.number(frame, p.health, 90, 171, 'STTNUM');
    this.blit(frame, this.patch('STTPRCNT'), 90, 171);
    this.number(frame, p.armor, 221, 171, 'STTNUM');
    this.blit(frame, this.patch('STTPRCNT'), 221, 171);

    // 무기 칸 (2~7): 가진 것은 노랑, 없으면 회색
    WEAPON_SLOTS.forEach((w, i) => {
      const n = i + 2;
      const owned = p.weapons.has(w) || (w === 'shotgun' && p.weapons.has('superShotgun'));   // 3번 칸 = 샷건 또는 슈퍼 샷건
      this.blit(frame, this.patch(`${owned ? 'STYSNUM' : 'STGNUM'}${n}`), 111 + (i % 3) * 12, 172 + Math.floor(i / 3) * 10);
    });

    // 열쇠
    ['blue', 'yellow', 'red'].forEach((k, i) => { if (p.keys[k]) this.blit(frame, this.patch(`STKEYS${i}`), 239, 171 + i * 10); });

    // 탄약 현황 (현재 / 최대)
    AMMO_ORDER.forEach((a, i) => {
      this.number(frame, p.ammo[a], 288, 173 + i * 6, 'STYSNUM');
      this.number(frame, p.maxAmmo[a], 314, 173 + i * 6, 'STYSNUM');
    });

    this.blit(frame, this.patch(this.faceName(game)), 143, 168);
  }

  /** 얼굴: 체력에 따라 5단계, 맞으면 찡그림/돌아봄, 무기를 주우면 씩 웃음, 오래 쏘면 분노 */
  faceName(game) {
    const p = game.player;
    if (p.dead) return 'STFDEAD0';
    if (p.god || p.powers.invuln > 0) return 'STFGOD0';
    const pain = Math.min(4, Math.floor(((100 - Math.min(p.health, 100)) * 5) / 101));

    if (game.hurtFace > 0 && p.attacker) {
      if (game.lastDamage >= 20) return `STFOUCH${pain}`;
      const diff = normAngle(p.attackerAngle - p.angle);
      if (Math.abs(diff) < Math.PI / 4) return `STFKILL${pain}`;  // 정면에서 맞음
      return `${diff > 0 ? 'STFTL' : 'STFTR'}${pain}0`;
    }
    if (p.grin > 0) return `STFEVL${pain}`;
    if (p.fireTics > 70) return `STFKILL${pain}`;
    const look = Math.floor(game.time / 17);
    return `STFST${pain}${(Math.imul(look, 2654435761) >>> 0) % 3}`;
  }
}

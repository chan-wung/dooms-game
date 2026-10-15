import { SCREEN_W as W, VIEW_H, pspriteColormap } from '../render/renderer.js';
import { WEAPONS } from '../game/weapons.js';

/**
 * 화면 아래 상태바(체력·방어구·탄약·무기 칸·열쇠·얼굴)와 손에 든 무기 스프라이트.
 * 위치는 원작 st_stuff.c 의 좌표를 그대로 쓴다 (320×200 화면, 상태바는 y = 168 부터).
 */
const ST_Y = 168;
const WEAPON_SLOTS = ['pistol', 'shotgun', 'chaingun', 'rocketLauncher', 'plasmaGun', 'bfg']; // 번호 2~7
const AMMO_ORDER = ['clip', 'shell', 'cell', 'rocket'];

const TWO_PI = Math.PI * 2;
const normAngle = (a) => { a %= TWO_PI; return a > Math.PI ? a - TWO_PI : a < -Math.PI ? a + TWO_PI : a; };

export class Hud {
  constructor(gfx, wad) {
    this.wad = wad;
    this.sprites = gfx.sprites;
    this.lit = gfx.palette.lit;
    this.cache = new Map();
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

  // ---------- 손에 든 무기 ----------
  drawWeapon(frame, game, view) {
    const p = game.player;
    const def = WEAPONS[p.readyWeapon];
    if (!def) return;
    const ps = p.psp.weapon;
    const lightCmap = view.colormap ?? pspriteColormap(p.sector.light, p.extraLight);
    const place = (spriteName, frameIdx, bright) => {
      const f = this.sprites.frame(spriteName, frameIdx);
      if (!f) return;
      const tex = this.sprites.tex(f.rot[0].lump);
      // 원작: 화면 가운데(x=160) 기준, 세로는 BASEYCENTER(100) 기준이라 3D 뷰가 168줄일 때 16줄 위로 올라온다
      const x = ps.sx - tex.leftOffset;
      const y = VIEW_H / 2 - (100 + 0.5 - (ps.sy - tex.topOffset));
      this.blit(frame, tex, x, y, bright ? 0 : lightCmap, VIEW_H, true);
    };
    place(def.sprite, ps.frame, ps.bright);
    const fl = p.psp.flash;
    if (fl && def.flashSprite) place(def.flashSprite, fl.frame, true); // 총구 화염은 항상 최대 밝기
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
      const owned = p.weapons.has(w);
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
    if (p.powers.invuln > 0) return 'STFGOD0';
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

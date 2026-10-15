'use strict';
/**
 * raycast-demo — Wolfenstein 3D 방식 레이캐스터 (바닐라 JS, 의존성 없음)
 * file:// 로 열어도 동작하도록 ES module 대신 일반 스크립트로 작성.
 * 구조: 설정 → 맵 → 상태 → 입력 → 업데이트 → 렌더(벽/스프라이트/HUD) → 루프
 */
(() => {
  // ---------- 설정 ----------
  const W = 640;
  const H = 400;
  const FOV_PLANE = 0.66;        // 카메라 평면 길이 (약 66° 시야각)
  const MOVE_SPEED = 3.2;        // 타일/초
  const TURN_SPEED = 2.4;        // rad/초
  const MOUSE_SENS = 0.0022;
  const PLAYER_R = 0.2;          // 충돌 반경
  const MAX_DIST = 24;
  const SPR = 32;                // 스프라이트 텍스처 크기

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------- 맵 (1,2 = 벽 / . = 바닥 / P = 시작 / E = 적) ----------
  const MAP_SRC = [
    '1111111111111111',
    '1P.....1.......1',
    '1......1...E...1',
    '1..22..1.......1',
    '1..22..........1',
    '1......11111.111',
    '1..............1',
    '111.1111.......1',
    '1...1..1...22..1',
    '1.E.1..1.......1',
    '1...1..1.......1',
    '1.......111.1..1',
    '1..............1',
    '1...2222.......1',
    '1.............E1',
    '1111111111111111'
  ];
  const MAP_H = MAP_SRC.length;
  const MAP_W = MAP_SRC[0].length;
  const WALL_COLORS = { 1: [150, 70, 60], 2: [70, 110, 150] };

  // ---------- 상태 ----------
  let player, enemies, kills, over, won, fireCd, flash, bob, time;
  let showMap = true;
  const zbuf = new Float32Array(W);

  const wallAt = (x, y) => {
    const mx = Math.floor(x), my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) return 1;
    const c = MAP_SRC[my][mx];
    return c === '1' || c === '2' ? Number(c) : 0;
  };

  const reset = () => {
    enemies = [];
    MAP_SRC.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === 'P') player = { x: x + 0.5, y: y + 0.5, a: 0, hp: 100 };
      if (c === 'E') enemies.push({ x: x + 0.5, y: y + 0.5, hp: 3, hurt: 0, atk: 0, dead: false });
    }));
    kills = 0; over = false; won = false; fireCd = 0; flash = 0; bob = 0; time = 0;
  };

  // ---------- 스프라이트 텍스처 (코드로 생성) ----------
  const makeDemon = (hurt) => {
    const c = document.createElement('canvas');
    c.width = c.height = SPR;
    const g = c.getContext('2d');
    const body = hurt ? '#ffffff' : '#a8322a';
    const dark = hurt ? '#dddddd' : '#5c1812';
    g.fillStyle = dark;                                   // 뿔
    g.fillRect(6, 2, 4, 8); g.fillRect(22, 2, 4, 8);
    g.fillStyle = body;                                   // 몸통/머리
    g.fillRect(8, 8, 16, 22);
    g.fillRect(5, 14, 22, 10);
    g.fillStyle = dark;                                   // 팔 그림자
    g.fillRect(5, 20, 4, 10); g.fillRect(23, 20, 4, 10);
    g.fillStyle = '#ffd23c';                              // 눈
    g.fillRect(11, 12, 4, 3); g.fillRect(17, 12, 4, 3);
    g.fillStyle = '#1a0000';                              // 입
    g.fillRect(12, 20, 8, 4);
    g.fillStyle = '#fff';
    g.fillRect(13, 20, 1, 2); g.fillRect(16, 20, 1, 2); g.fillRect(19, 20, 1, 2);
    return c;
  };
  const SPR_NORMAL = makeDemon(false);
  const SPR_HURT = makeDemon(true);

  // ---------- 입력 ----------
  const keys = Object.create(null);
  let wantFire = false;
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') { wantFire = true; e.preventDefault(); }
    if (e.code === 'KeyM') showMap = !showMap;
    if (e.code === 'KeyR') reset();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space') wantFire = false;
  });
  canvas.addEventListener('mousedown', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    wantFire = true;
  });
  window.addEventListener('mouseup', () => { wantFire = false; });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) player.a += e.movementX * MOUSE_SENS;
  });

  // ---------- 업데이트 ----------
  const tryMove = (o, nx, ny, r) => {
    if (!wallAt(nx + Math.sign(nx - o.x) * r, o.y)) o.x = nx;
    if (!wallAt(o.x, ny + Math.sign(ny - o.y) * r)) o.y = ny;
  };

  // 두 점 사이에 벽이 없는지 (적 시야 판정)
  const hasLOS = (x0, y0, x1, y1) => {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 0.15);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (wallAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  };

  const shoot = () => {
    fireCd = 0.28; flash = 0.07;
    const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    let best = null, bestD = Infinity;
    enemies.forEach((en) => {
      if (en.dead) return;
      const dx = en.x - player.x, dy = en.y - player.y;
      const fwd = dx * dirX + dy * dirY;
      if (fwd <= 0.2) return;
      const lat = Math.abs(-dx * dirY + dy * dirX);
      if (lat > 0.32) return;                              // 조준선에서 벗어남
      if (!hasLOS(player.x, player.y, en.x, en.y)) return; // 벽 뒤
      if (fwd < bestD) { best = en; bestD = fwd; }
    });
    if (best) {
      best.hp -= 1; best.hurt = 0.12;
      if (best.hp <= 0) {
        best.dead = true; kills += 1;
        if (kills === enemies.length) won = true;
      }
    }
  };

  const update = (dt) => {
    if (over || won) return;
    time += dt;

    // 회전
    if (keys.ArrowLeft) player.a -= TURN_SPEED * dt;
    if (keys.ArrowRight) player.a += TURN_SPEED * dt;

    // 이동 (대각선 속도 보정)
    const fx = Math.cos(player.a), fy = Math.sin(player.a);
    const rx = -fy, ry = fx;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += fx; my += fy; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fx; my -= fy; }
    if (keys.KeyD) { mx += rx; my += ry; }
    if (keys.KeyA) { mx -= rx; my -= ry; }
    const len = Math.hypot(mx, my);
    if (len > 0) {
      const s = (MOVE_SPEED * dt) / len;
      tryMove(player, player.x + mx * s, player.y + my * s, PLAYER_R);
      bob += dt * 9;
    }

    // 발사
    fireCd = Math.max(0, fireCd - dt);
    flash = Math.max(0, flash - dt);
    if (wantFire && fireCd === 0) shoot();

    // 적 AI
    enemies.forEach((en) => {
      if (en.dead) return;
      en.hurt = Math.max(0, en.hurt - dt);
      en.atk = Math.max(0, en.atk - dt);
      const dx = player.x - en.x, dy = player.y - en.y;
      const d = Math.hypot(dx, dy);
      if (d < 9 && hasLOS(en.x, en.y, player.x, player.y)) {
        if (d > 0.8) {
          const s = (0.95 * dt) / d;
          tryMove(en, en.x + dx * s, en.y + dy * s, 0.25);
        } else if (en.atk === 0) {
          en.atk = 0.8;
          player.hp -= 8;
          if (player.hp <= 0) { player.hp = 0; over = true; }
        }
      }
    });
  };

  // ---------- 렌더: 벽 ----------
  const renderWalls = () => {
    // 천장 / 바닥
    const sky = ctx.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, '#15151c'); sky.addColorStop(1, '#2a2a34');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H / 2);
    const flr = ctx.createLinearGradient(0, H / 2, 0, H);
    flr.addColorStop(0, '#1c1814'); flr.addColorStop(1, '#3a322a');
    ctx.fillStyle = flr; ctx.fillRect(0, H / 2, W, H / 2);

    const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    const planeX = -dirY * FOV_PLANE, planeY = dirX * FOV_PLANE;

    for (let x = 0; x < W; x++) {
      const camX = (2 * x) / W - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;

      let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
      const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (player.x - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - player.x) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (player.y - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - player.y) * ddy; }

      let side = 0, hit = 0;
      while (!hit) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
        hit = wallAt(mapX + 0.5, mapY + 0.5);
      }

      const dist = side === 0 ? sdx - ddx : sdy - ddy;       // 어안렌즈 보정된 수직 거리
      zbuf[x] = dist;

      const lineH = Math.min(H * 4, Math.floor(H / dist));
      const top = Math.floor((H - lineH) / 2);

      // 벽면 내 x 좌표 → 타일 경계선 / 벽돌 줄눈 느낌
      let wallX = side === 0 ? player.y + dist * rdy : player.x + dist * rdx;
      wallX -= Math.floor(wallX);

      const base = WALL_COLORS[hit];
      let shade = Math.max(0.15, 1 - dist / MAX_DIST) * (side ? 0.72 : 1);
      if (wallX < 0.03 || wallX > 0.97) shade *= 0.55;
      ctx.fillStyle = `rgb(${base[0] * shade | 0},${base[1] * shade | 0},${base[2] * shade | 0})`;
      ctx.fillRect(x, top, 1, lineH);

      // 가로 줄눈 (벽돌 단)
      ctx.fillStyle = `rgba(0,0,0,${0.22 * shade})`;
      const rows = 6;
      for (let r = 1; r < rows; r++) ctx.fillRect(x, top + Math.floor((lineH * r) / rows), 1, 1);
    }
  };

  // ---------- 렌더: 스프라이트 ----------
  const renderSprites = () => {
    const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    const rX = -dirY, rY = dirX;

    const list = enemies
      .filter((e) => !e.dead)
      .map((e) => {
        const dx = e.x - player.x, dy = e.y - player.y;
        return { e, fwd: dx * dirX + dy * dirY, lat: dx * rX + dy * rY };
      })
      .filter((s) => s.fwd > 0.15)
      .sort((a, b) => b.fwd - a.fwd);                        // 먼 것부터

    list.forEach(({ e, fwd, lat }) => {
      const screenX = (W / 2) * (1 + lat / (fwd * FOV_PLANE));
      const size = Math.abs(H / fwd);
      const left = Math.floor(screenX - size / 2);
      const tex = e.hurt > 0 ? SPR_HURT : SPR_NORMAL;
      const topY = Math.floor(H / 2 - size / 2);
      const x0 = Math.max(0, left);
      const x1 = Math.min(W - 1, Math.floor(left + size));
      for (let x = x0; x <= x1; x++) {
        if (fwd >= zbuf[x]) continue;                        // 벽에 가림
        const tx = Math.min(SPR - 1, Math.floor(((x - left) / size) * SPR));
        ctx.drawImage(tex, tx, 0, 1, SPR, x, topY, 1, size);
      }
    });
  };

  // ---------- 렌더: HUD ----------
  const renderWeapon = () => {
    const sway = Math.sin(bob) * 6;
    const kick = fireCd > 0 ? (fireCd / 0.28) * 14 : 0;
    const cx = W / 2 + sway;
    const y = H - 70 + kick + Math.abs(Math.cos(bob)) * 4;
    if (flash > 0) {
      ctx.fillStyle = '#ffd23c';
      ctx.fillRect(cx - 10, y - 34, 20, 22);
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 5, y - 28, 10, 12);
    }
    ctx.fillStyle = '#3a3a42'; ctx.fillRect(cx - 12, y - 14, 24, 30);
    ctx.fillStyle = '#55555f'; ctx.fillRect(cx - 8, y - 14, 16, 30);
    ctx.fillStyle = '#26262c'; ctx.fillRect(cx - 28, y + 16, 56, 60);
    ctx.fillStyle = '#c9a07a'; ctx.fillRect(cx - 18, y + 22, 36, 16);
  };

  const renderMinimap = () => {
    const s = 8, ox = 8, oy = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(ox - 2, oy - 2, MAP_W * s + 4, MAP_H * s + 4);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const w = wallAt(x + 0.5, y + 0.5);
        if (w) { ctx.fillStyle = `rgb(${WALL_COLORS[w].join(',')})`; ctx.fillRect(ox + x * s, oy + y * s, s - 1, s - 1); }
      }
    }
    ctx.fillStyle = '#ff3c3c';
    enemies.forEach((e) => { if (!e.dead) ctx.fillRect(ox + e.x * s - 2, oy + e.y * s - 2, 4, 4); });
    ctx.fillStyle = '#7dff8a';
    ctx.fillRect(ox + player.x * s - 2, oy + player.y * s - 2, 4, 4);
    ctx.strokeStyle = '#7dff8a';
    ctx.beginPath();
    ctx.moveTo(ox + player.x * s, oy + player.y * s);
    ctx.lineTo(ox + (player.x + Math.cos(player.a) * 1.5) * s, oy + (player.y + Math.sin(player.a) * 1.5) * s);
    ctx.stroke();
  };

  const renderHud = () => {
    // 조준점
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(W / 2 - 1, H / 2 - 6, 2, 4); ctx.fillRect(W / 2 - 1, H / 2 + 2, 2, 4);
    ctx.fillRect(W / 2 - 6, H / 2 - 1, 4, 2); ctx.fillRect(W / 2 + 2, H / 2 - 1, 4, 2);

    // 하단 바
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 22, W, 22);
    ctx.font = '14px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = player.hp > 30 ? '#7dff8a' : '#ff5a3c';
    ctx.fillText(`HP ${String(player.hp).padStart(3, ' ')}`, 12, H - 11);
    ctx.fillStyle = '#ffd23c';
    ctx.fillText(`KILLS ${kills}/${enemies.length}`, 110, H - 11);

    // 피격 비네트
    if (player.hp < 100 && !over) {
      ctx.fillStyle = `rgba(160,0,0,${(1 - player.hp / 100) * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (over || won) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.font = '32px ui-monospace, Consolas, monospace';
      ctx.fillStyle = won ? '#7dff8a' : '#ff5a3c';
      ctx.fillText(won ? 'CLEARED' : 'YOU DIED', W / 2, H / 2 - 8);
      ctx.font = '14px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#ccc';
      ctx.fillText('R 키로 재시작', W / 2, H / 2 + 24);
      ctx.textAlign = 'left';
    }
  };

  // ---------- 메인 루프 ----------
  reset();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderWalls();
    renderSprites();
    renderWeapon();
    if (showMap) renderMinimap();
    renderHud();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();

import { sectorAt } from '../render/bsp.js';

export const EYE_HEIGHT = 41;
const MOVE_SPEED = 290;  // 맵 유닛/초 (원작 걷기 속도 근처)
const TURN_SPEED = 2.4;  // rad/초
export const MOUSE_SENS = 0.0025;

/** 시작점에서 플레이어 생성. angle 은 라디안(반시계 +), z 는 눈높이 */
export const createPlayer = (level) => {
  const s = level.playerStart;
  const p = { x: s?.x ?? 0, y: s?.y ?? 0, angle: ((s?.angle ?? 0) * Math.PI) / 180, z: 0, sector: null };
  updateSector(p, level);
  return p;
};

const updateSector = (p, level) => {
  p.sector = sectorAt(level, p.x, p.y);
  p.z = p.sector.floorHeight + EYE_HEIGHT;
};

/** 충돌 없는 이동 (Phase 4에서 BLOCKMAP 충돌/물리로 교체). mouseDX: 이번 프레임 마우스 이동량(px) */
export const updatePlayer = (p, level, dt, keys, mouseDX = 0) => {
  p.angle -= mouseDX * MOUSE_SENS;
  if (keys.ArrowLeft) p.angle += TURN_SPEED * dt;
  if (keys.ArrowRight) p.angle -= TURN_SPEED * dt;

  const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) { mx += fx; my += fy; }
  if (keys.KeyS || keys.ArrowDown) { mx -= fx; my -= fy; }
  if (keys.KeyD) { mx += fy; my -= fx; }   // 오른쪽 = (sin, -cos)
  if (keys.KeyA) { mx -= fy; my += fx; }
  const len = Math.hypot(mx, my);
  if (len > 0) { p.x += (mx / len) * MOVE_SPEED * dt; p.y += (my / len) * MOVE_SPEED * dt; }
  updateSector(p, level);
};

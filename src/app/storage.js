/**
 * 브라우저 저장소(localStorage): 설정과 세이브 슬롯.
 * 슬롯 0 = 맵을 시작할 때의 자동 저장(AUTO), 1~5 = 수동 저장.
 * 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 무시한다.
 */
const SETTINGS_KEY = 'doomjs.settings';
const SLOT_KEY = (n) => `doomjs.slot${n}`;
const LEGACY_SAVE_KEY = 'doomjs.save';   // 예전 단일 자동 저장 (v1)
export const SLOT_COUNT = 6;             // 0 = AUTO, 1~5 = 수동

const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };

// ---------- 설정 ----------
export const loadSettings = (defaults) => ({ ...defaults, ...(read(SETTINGS_KEY) || {}) });
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

// ---------- 세이브 슬롯 ----------
/** 예전 형식(v1: 맵 시작 상태만)을 슬롯 데이터로 */
const migrateLegacy = () => {
  const s = read(LEGACY_SAVE_KEY);
  return s?.v === 1 && s.map ? { v: 1, kind: 'start', map: s.map, skill: s.skill, state: s.state, name: `${s.map}  START`, savedAt: 0 } : null;
};

/** 슬롯 내용 (없으면 null). 슬롯 0 은 옛 저장이 있으면 그것을 돌려준다 */
export const readSlot = (n) => {
  const s = read(SLOT_KEY(n));
  if (s && s.map) return s;
  return n === 0 ? migrateLegacy() : null;
};

export const writeSlot = (n, data) => write(SLOT_KEY(n), data);
export const listSlots = () => Array.from({ length: SLOT_COUNT }, (_, n) => readSlot(n));

/** 슬롯 이름: 맵과 저장한 시각 (모바일에서도 입력 없이) */
export const slotName = (map, when = new Date()) => {
  const p = (v) => String(v).padStart(2, '0');
  return `${map}  ${p(when.getMonth() + 1)}/${p(when.getDate())} ${p(when.getHours())}:${p(when.getMinutes())}`;
};

// 마지막으로 쓴 수동 슬롯 (퀵세이브/퀵로드용)
const LAST_KEY = 'doomjs.lastslot';
export const lastSlot = () => { const n = Number(read(LAST_KEY)); return n >= 1 && n < SLOT_COUNT ? n : 1; };
export const setLastSlot = (n) => write(LAST_KEY, n);

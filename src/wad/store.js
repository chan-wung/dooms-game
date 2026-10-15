/**
 * 사용자가 고른 WAD 파일(약 4MB)을 브라우저 IndexedDB 에 저장해 두었다가
 * 다음 접속 때 다시 고르지 않아도 되게 한다. WAD 는 서버로 올라가지 않고 이 브라우저에만 남는다.
 */
const DB = 'doom-js', STORE = 'wad', KEY = 'iwad';

const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const run = async (mode, fn) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
};

/** 저장 (실패해도 게임은 계속하도록 조용히 false) */
export async function saveWad(buffer, name) {
  try { await run('readwrite', (s) => s.put({ buffer, name, savedAt: Date.now() }, KEY)); return true; } catch { return false; }
}

/** 저장된 WAD → { buffer, name } 또는 null */
export async function loadSavedWad() {
  try { return (await run('readonly', (s) => s.get(KEY))) ?? null; } catch { return null; }
}

export async function clearSavedWad() {
  try { await run('readwrite', (s) => s.delete(KEY)); return true; } catch { return false; }
}

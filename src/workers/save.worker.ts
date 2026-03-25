/**
 * Save Worker — performs JSON.stringify + IndexedDB write off the main thread.
 *
 * Main → Worker:
 *   { type: 'SAVE', snapshot: object, slotId: number, name: string, population?: number }
 *
 * Worker → Main:
 *   { type: 'SAVE_COMPLETE', ok: boolean, error?: string }
 */

const DB_NAME = 'webcity-saves';
const STORE_NAME = 'saves';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, snapshot, slotId, name, population } = e.data;
  if (type !== 'SAVE') return;

  try {
    const json = JSON.stringify(snapshot);
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        id: slotId,
        name,
        date: new Date().toISOString(),
        data: json,
        population,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    (self as unknown as Worker).postMessage({ type: 'SAVE_COMPLETE', ok: true });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'SAVE_COMPLETE', ok: false, error: String(err) });
  }
};

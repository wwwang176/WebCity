export interface SaveSlot {
  id: number;
  name: string;
  date: string;
  data: string;
  population?: number;
}

export const SAVE_CONFIG = {
  DB_NAME: 'webcity-saves',
  STORE_NAME: 'saves',
  DB_VERSION: 1,
} as const;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVE_CONFIG.DB_NAME, SAVE_CONFIG.DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVE_CONFIG.STORE_NAME)) {
        db.createObjectStore(SAVE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGame(slotId: number, name: string, data: string, population?: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(SAVE_CONFIG.STORE_NAME);
    const slot: SaveSlot = {
      id: slotId,
      name,
      date: new Date().toISOString(),
      data,
    };
    if (population !== undefined) slot.population = population;
    const request = store.put(slot);
    // Resolve on COMMIT, not on the request callback. IndexedDB fires
    // `request.onsuccess` once the write is applied in memory — the transaction
    // has not committed yet and can still abort (quota exceeded at commit time,
    // disk error, forced abort, page teardown). Resolving there reported success
    // for saves that were never persisted, and an abort could never reject an
    // already-settled promise. save.worker.ts already does this correctly.
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function loadGame(slotId: number): Promise<SaveSlot | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_CONFIG.STORE_NAME, 'readonly');
    const store = tx.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.get(slotId);
    request.onsuccess = () => resolve((request.result as SaveSlot | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listSaves(): Promise<SaveSlot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_CONFIG.STORE_NAME, 'readonly');
    const store = tx.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as SaveSlot[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteSave(slotId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.delete(slotId);
    // Same commit-vs-request ordering as saveGame above.
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

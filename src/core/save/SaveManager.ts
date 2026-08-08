import { SaveBlockedError } from './SaveFailure';

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
    // `blocked` is dispatched INSTEAD of success or error, when another
    // connection still holds an older DB version open. Nothing else follows it,
    // so an unhandled `blocked` leaves this promise pending for the lifetime of
    // the page: every save, load and list behind it waits forever, and the
    // player sees a loading screen that never advances and never errors.
    // It cannot fire while DB_VERSION stays at 1, which is exactly why it would
    // have gone unnoticed until the first schema change.
    request.onblocked = () => reject(new SaveBlockedError());
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
    // already-settled promise.
    //
    // The request handler comes first and rejects with the REQUEST's error,
    // which is where a QuotaExceededError actually lives — `tx.error` is still
    // null at this instant. save.worker.ts used to carry its own copy of this
    // block, got that detail backwards, and reported every quota failure as a
    // generic "Save request failed"; it now calls this function instead.
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Save transaction aborted')); };
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
    // A read transaction can abort with no request error at all — a
    // versionchange from another tab, deleteDatabase closing the connection, an
    // I/O fault. Unwired, main.ts's `await loadGame(...)` never settles and the
    // loading screen hangs with no message (BUG-114).
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Load transaction aborted')); };
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
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('List transaction aborted')); };
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
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Save transaction aborted')); };
  });
}

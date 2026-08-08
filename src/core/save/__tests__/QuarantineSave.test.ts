import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveGame, listSaves, quarantineSave, QUARANTINE_PREFIX } from '../SaveManager';

/**
 * "The damaged save is left untouched, so you can still export it" was true
 * only until the player pressed the other button on the menu.
 *
 * Autosave writes slot 0 unconditionally (Game.ts), and slot 0 is the AutoSave
 * slot — the one most likely to be the broken one. So after a failed load of
 * slot 0, starting a New Game overwrote the bytes 100 ticks later: recovery was
 * one click slower than before, not preserved. Copying the unreadable bytes
 * somewhere nothing writes to makes the promise true whatever they press next.
 */
type Row = { id: number; name: string; date: string; data: string; population?: number };

/** An in-memory IndexedDB good enough for get/getAll/put/delete. */
function installFakeIDB(rows: Row[] = []): Map<number, Row> {
  const store = new Map<number, Row>(rows.map(r => [r.id, r]));

  const settle = (req: { onsuccess: (() => void) | null }, tx: { oncomplete: (() => void) | null }) => {
    queueMicrotask(() => { req.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
  };

  const db = {
    transaction: () => {
      const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null, error: null,
        objectStore: () => ({
          get: (id: number) => {
            const req = { onsuccess: null as (() => void) | null, onerror: null, result: store.get(id) };
            settle(req, tx); return req;
          },
          getAll: () => {
            const req = { onsuccess: null as (() => void) | null, onerror: null, result: [...store.values()] };
            settle(req, tx); return req;
          },
          put: (row: Row) => {
            store.set(row.id, row);
            const req = { onsuccess: null as (() => void) | null, onerror: null, result: row.id };
            settle(req, tx); return req;
          },
          delete: (id: number) => {
            store.delete(id);
            const req = { onsuccess: null as (() => void) | null, onerror: null, result: undefined };
            settle(req, tx); return req;
          },
        }),
      };
      return tx;
    },
    close: () => {},
    objectStoreNames: { contains: () => true },
  };

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req = { onsuccess: null as (() => void) | null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return store;
}

const damaged: Row = {
  id: 0, name: 'AutoSave', date: '2026-01-01T00:00:00.000Z',
  data: '{"version":7,"grid":', population: 4200,
};

describe('an unreadable save is copied somewhere nothing writes to', () => {
  let store: Map<number, Row>;

  beforeEach(() => { store = installFakeIDB([damaged]); });
  afterEach(() => { delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB; });

  it('should copy the bytes verbatim into a free slot', () => {
    return quarantineSave(0).then(async (target) => {
      expect(target, 'no copy was made').not.toBeNull();
      expect(target).not.toBe(0);
      const copy = store.get(target!)!;
      expect(copy.data, 'the copy must be byte-identical').toBe(damaged.data);
      expect(copy.population).toBe(4200);
      // ...and the original is still where it was.
      expect(store.get(0)!.data).toBe(damaged.data);
      expect(await listSaves()).toHaveLength(2);
    });
  });

  it('should mark the copy so the player can tell what it is', async () => {
    const target = await quarantineSave(0);
    expect(store.get(target!)!.name).toBe(`${QUARANTINE_PREFIX}AutoSave`);
  });

  it('should survive slot 0 being overwritten afterwards', () => {
    // The whole point: this is what New Game + autosave does 100 ticks later.
    return quarantineSave(0).then(async (target) => {
      await saveGame(0, 'AutoSave', '{"version":7,"grid":{"width":12,"height":12,"cells":[]}}', 0);
      expect(store.get(0)!.data).not.toBe(damaged.data);
      expect(store.get(target!)!.data, 'the only copy was lost').toBe(damaged.data);
    });
  });

  it('should not pile up copies when the same slot fails twice', async () => {
    const first = await quarantineSave(0);
    const second = await quarantineSave(0);
    expect(second).toBe(first);
    expect(await listSaves()).toHaveLength(2);
  });

  it('should pick a slot that is not already taken', async () => {
    store.set(1, { id: 1, name: 'My City', date: 'x', data: '{}' });
    store.set(2, { id: 2, name: 'Other', date: 'x', data: '{}' });
    const target = await quarantineSave(0);
    expect(target).toBe(3);
    expect(store.get(1)!.name, 'an existing save was clobbered').toBe('My City');
  });

  it('should do nothing for an empty slot', async () => {
    expect(await quarantineSave(9)).toBeNull();
  });

  it('should never throw, whatever the database does', async () => {
    // It runs on a path that is already failing; losing the copy must not also
    // lose the error the player was about to be shown.
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
      open: () => { throw new Error('no database here'); },
    };
    await expect(quarantineSave(0)).resolves.toBeNull();
  });
});

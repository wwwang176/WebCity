import { describe, it, expect, afterEach } from 'vitest';
import { saveGame, deleteSave, loadGame } from '../SaveManager';

/**
 * IndexedDB fires `request.onsuccess` as soon as the operation is *queued and
 * applied in memory* — the transaction has not committed yet. A write can still
 * fail afterwards (quota exceeded at commit, disk error, forced abort, page
 * teardown), in which case the transaction aborts and the data is never durable.
 *
 * These tests drive that exact window: the put/delete request succeeds, then the
 * transaction aborts. A correct implementation must reject with the transaction
 * error — asserting on the message so a stray TypeError from a broken fake can
 * never make the test pass for the wrong reason.
 */

type Handler = (() => void) | null;

interface FakeRequest { onsuccess: Handler; onerror: Handler; result?: unknown; error?: unknown }

const ABORT_ERROR = new Error('QuotaExceededError');

/**
 * Installs a fake indexedDB.
 * @param outcome 'abort' aborts the transaction after the request succeeds;
 *                'commit' completes normally.
 */
function installFakeIDB(outcome: 'abort' | 'commit' | 'abort-before-success'): void {
  const tx = {
    oncomplete: null as Handler,
    onerror: null as Handler,
    onabort: null as Handler,
    error: outcome === 'commit' ? null : ABORT_ERROR,
    objectStore: () => ({ put: makeRequest, delete: makeRequest, get: makeRequest }),
  };

  /** Every store operation resolves first; the transaction settles one turn later. */
  function makeRequest(): FakeRequest {
    const req: FakeRequest = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      // A transaction can abort before its request ever succeeds — the case
      // where an unwired onabort strands the promise forever.
      if (outcome === 'abort-before-success') { tx.onabort?.(); return; }
      req.onsuccess?.();
      queueMicrotask(() => {
        // Real IndexedDB dispatches ONLY `abort` for a commit-time failure; the
        // transaction's error event exists solely to receive a bubbled request
        // error. Firing both made this fake unable to tell a correct onabort
        // handler from an onerror one — it would have passed the bug that was
        // still live in save.worker.ts (BUG-114).
        if (outcome === 'abort') tx.onabort?.();
        else tx.oncomplete?.();
      });
    });
    return req;
  }

  const db = { transaction: () => tx, close: () => {}, objectStoreNames: { contains: () => true } };

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: FakeRequest = { onsuccess: null, onerror: null, result: db };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

describe('SaveManager durability', () => {
  afterEach(() => {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
  });

  it('should reject saveGame when the transaction aborts after the put succeeds', async () => {
    installFakeIDB('abort');
    await expect(saveGame(1, 'slot', '{}')).rejects.toThrow('QuotaExceededError');
  });

  it('should reject deleteSave when the transaction aborts after the delete succeeds', async () => {
    installFakeIDB('abort');
    await expect(deleteSave(1)).rejects.toThrow('QuotaExceededError');
  });

  it('should still resolve saveGame when the transaction commits', async () => {
    installFakeIDB('commit');
    await expect(saveGame(1, 'slot', '{}')).resolves.toBeUndefined();
  });

  it('should still resolve reads when the transaction commits', async () => {
    installFakeIDB('commit');
    await expect(loadGame(1)).resolves.toBeNull();
  });

  it('should reject a read whose transaction aborts before it returns', async () => {
    // Unwired, this promise never settles and the loading screen hangs silently.
    // (An abort AFTER onsuccess is harmless — the data already arrived.)
    installFakeIDB('abort-before-success');
    await expect(loadGame(1)).rejects.toThrow('QuotaExceededError');
  });

  it('should reject a save whose transaction aborts before the put returns', async () => {
    installFakeIDB('abort-before-success');
    await expect(saveGame(1, 'slot', '{}')).rejects.toThrow('QuotaExceededError');
  });
});

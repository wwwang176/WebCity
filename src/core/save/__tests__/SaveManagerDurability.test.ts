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
function installFakeIDB(outcome: 'abort' | 'commit'): void {
  const tx = {
    oncomplete: null as Handler,
    onerror: null as Handler,
    onabort: null as Handler,
    error: outcome === 'abort' ? ABORT_ERROR : null,
    objectStore: () => ({ put: makeRequest, delete: makeRequest, get: makeRequest }),
  };

  /** Every store operation resolves first; the transaction settles one turn later. */
  function makeRequest(): FakeRequest {
    const req: FakeRequest = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      req.onsuccess?.();
      queueMicrotask(() => {
        if (outcome === 'abort') { tx.onabort?.(); tx.onerror?.(); }
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
});

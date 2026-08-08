import { describe, it, expect, vi } from 'vitest';
import { handleSaveRequest, type SaveCompleteMessage } from '../SaveWorkerHandler';

/**
 * Autosave runs entirely through this handler, and until now every one of its
 * replies was dropped on the floor: Game.ts had no `saveWorker.onmessage`. A
 * player whose storage filled up kept playing for as long as they liked on a
 * city that had silently stopped being written.
 *
 * So the two things worth pinning are that a failure produces a message at all,
 * and that the message says something true about why.
 */
function collector() {
  const posted: SaveCompleteMessage[] = [];
  return { posted, post: (m: SaveCompleteMessage) => { posted.push(m); } };
}

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), {
  name: 'QuotaExceededError',
});

describe('the save worker always answers', () => {
  it('should report success with the slot it wrote', async () => {
    const { posted, post } = collector();
    const write = vi.fn().mockResolvedValue(undefined);

    await handleSaveRequest(
      { type: 'SAVE', snapshot: { a: 1 }, slotId: 3, name: 'AutoSave', population: 12 },
      post, write,
    );

    expect(posted).toEqual([{ type: 'SAVE_COMPLETE', ok: true, slotId: 3 }]);
    expect(write).toHaveBeenCalledWith(3, 'AutoSave', '{"a":1}', 12);
  });

  it('should report a quota failure as a quota failure', async () => {
    // The old worker rejected with `tx.error ?? new Error('Save request
    // failed')`, and `tx.error` is null at request-error time — so the one
    // thing the player needed to know was replaced by a generic string.
    const { posted, post } = collector();
    const write = vi.fn().mockRejectedValue(quotaError());

    await handleSaveRequest({ type: 'SAVE', snapshot: {}, slotId: 0, name: 'AutoSave' }, post, write);

    expect(posted).toHaveLength(1);
    expect(posted[0]!.ok).toBe(false);
    expect(posted[0]!.kind).toBe('QUOTA');
    expect(posted[0]!.error).toMatch(/storage/i);
    expect(posted[0]!.detail).toContain('quota');
  });

  it('should answer even when the snapshot itself cannot be stringified', async () => {
    // A cycle in the snapshot threw before any postMessage in the old handler's
    // try block ordering, leaving the main thread waiting for a reply forever.
    const { posted, post } = collector();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const write = vi.fn();

    await handleSaveRequest({ type: 'SAVE', snapshot: cyclic, slotId: 1, name: 'x' }, post, write);

    expect(write).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.ok).toBe(false);
  });

  it('should never report ok when the write rejected', async () => {
    const { posted, post } = collector();
    await handleSaveRequest(
      { type: 'SAVE', snapshot: {}, slotId: 0, name: 'AutoSave' },
      post, vi.fn().mockRejectedValue(new Error('disk')),
    );
    expect(posted.every(m => m.ok === false)).toBe(true);
  });

  it('should ignore messages that are not a save request', async () => {
    const { posted, post } = collector();
    const write = vi.fn();
    for (const junk of [null, undefined, 'SAVE', 42, { type: 'LOAD' }, {}]) {
      await handleSaveRequest(junk, post, write);
    }
    expect(posted).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('should carry the slot id back so a stale reply cannot be misread', async () => {
    // Autosave writes slot 0 and a manual save writes another; without the id
    // the main thread cannot tell which save a failure belongs to.
    const { posted, post } = collector();
    await handleSaveRequest(
      { type: 'SAVE', snapshot: {}, slotId: 7, name: 'Manual' },
      post, vi.fn().mockRejectedValue(quotaError()),
    );
    expect(posted[0]!.slotId).toBe(7);
  });
});

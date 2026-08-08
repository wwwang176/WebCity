import { describe, it, expect } from 'vitest';
import { runBatch, type BatchRequestItem } from '../PathfindingWorkerHandler';

function req(id: number): BatchRequestItem {
  return { id, startPointIndices: [0], endPointIndices: [1], endPos: { x: 0, y: 0 }, variantCount: 1 };
}

/** Reader whose version changes after the Nth read (0 = never). */
function readerBumpingAfter(n: number) {
  let reads = 0;
  let version = 7;
  return {
    getVersion() {
      reads++;
      if (n > 0 && reads > n) version = 8;
      return version;
    },
  };
}

describe('runBatch — mid-batch graph rewrite guard', () => {
  it('returns results when the graph version is stable', () => {
    const results = runBatch(readerBumpingAfter(0), [req(1), req(2)], () => [[10]]);
    expect(results).not.toBeNull();
    expect(results!.map(r => r.id)).toEqual([1, 2]);
  });

  it('discards the batch when the graph is rewritten mid-run', () => {
    // Version is read once at the start, then after each request.
    const results = runBatch(readerBumpingAfter(1), [req(1), req(2)], () => [[10]]);
    expect(results).toBeNull();
  });

  it('handles an empty request list', () => {
    expect(runBatch(readerBumpingAfter(0), [], () => [[10]])).toEqual([]);
  });

  it('does not call compute after aborting', () => {
    let calls = 0;
    runBatch(readerBumpingAfter(1), [req(1), req(2), req(3)], () => { calls++; return [[10]]; });
    expect(calls).toBe(1);
  });
});

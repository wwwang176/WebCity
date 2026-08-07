import { describe, it, expect } from 'vitest';
import { PathRequestBatcher } from '../PathRequestBatcher';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';

/**
 * The worker's BATCH_RESULT is a message task, so a reply computed against the
 * pre-demolition graph lands after markLaneGraphDirty has already cleared
 * routeIndex but before the next tick rebuilds the graph. onResult then wrote
 * those obsolete routes straight back, and spawnCommuteVehicles stamped them
 * with the NEW roadGeneration — making isExpired() permanently false, so cars
 * kept spawning onto roads that no longer existed until the next edit.
 *
 * clearPending() already drops inflightBatches, which makes handleMessage
 * ignore the reply; it was just being called a tick too late — in
 * syncGraphToWorker instead of markLaneGraphDirty (BUG-107).
 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  postMessage(msg: unknown): void { this.sent.push(msg); }
  addEventListener(_: string, fn: (e: { data: unknown }) => void): void { this.onmessage = fn; }
  removeEventListener(): void {}
  reply(data: unknown): void { this.onmessage?.({ data }); }
}

describe('in-flight worker results are dropped when the graph changes', () => {
  it('should ignore a batch result that arrives after clearPending', () => {
    const worker = new FakeWorker();
    const batcher = new PathRequestBatcher(
      worker as unknown as Worker,
      { pointIdToIndex: new Map([['a', 0], ['b', 1]]), edgeOriginals: [] },
    );

    const received: string[] = [];
    batcher.onResult = (routeKey) => received.push(routeKey);

    batcher.enqueue('r1', [0], [1], { x: 1, y: 1 });
    batcher.flush(10);
    const sent = worker.sent[0] as { batchId: number; requests: { id: number }[] };
    expect(sent.requests.length).toBeGreaterThan(0);

    // Road edit: the graph is now different from the one the worker used.
    batcher.clearPending();

    worker.reply({
      type: 'BATCH_RESULT',
      batchId: sent.batchId,
      results: [{ id: sent.requests[0]!.id, variants: [[0]] }],
    });

    expect(received).toHaveLength(0);
  });

  it('should still deliver a result when nothing changed', () => {
    const worker = new FakeWorker();
    const batcher = new PathRequestBatcher(
      worker as unknown as Worker,
      { pointIdToIndex: new Map([['a', 0], ['b', 1]]), edgeOriginals: [] },
    );

    const received: string[] = [];
    batcher.onResult = (routeKey) => received.push(routeKey);

    batcher.enqueue('r1', [0], [1], { x: 1, y: 1 });
    batcher.flush(10);
    const sent = worker.sent[0] as { batchId: number; requests: { id: number }[] };

    worker.reply({
      type: 'BATCH_RESULT',
      batchId: sent.batchId,
      results: [{ id: sent.requests[0]!.id, variants: [[0]] }],
    });

    expect(received).toEqual(['r1']);
  });
});

describe('markLaneGraphDirty drops in-flight worker results', () => {
  it('should clear pending work at the moment of the edit, not a tick later', () => {
    // This is the actual wiring the bug was about: clearPending lived in
    // syncGraphToWorker, which runs on the NEXT tick, leaving a window in which
    // a pre-edit reply could land and be written back as current.
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const worker = new FakeWorker();
    loop.setPathfindingWorker(worker as unknown as Worker);

    const batcher = (loop as unknown as { pathBatcher: PathRequestBatcher | null }).pathBatcher!;
    expect(batcher).toBeTruthy();

    const received: string[] = [];
    batcher.onResult = (routeKey) => received.push(routeKey);
    (batcher as unknown as { mapping: unknown }).mapping = {
      pointIdToIndex: new Map([['a', 0], ['b', 1]]), edgeOriginals: [],
    };
    batcher.updateMapping({ pointIdToIndex: new Map([['a', 0], ['b', 1]]), edgeOriginals: [] });

    batcher.enqueue('r1', [0], [1], { x: 1, y: 1 });
    batcher.flush(10);
    const batchMsg = worker.sent.find(
      (m) => (m as { type?: string }).type === 'BATCH_REQUEST',
    ) as { batchId: number; requests: { id: number }[] } | undefined;
    expect(batchMsg).toBeTruthy();

    // The player demolishes a road — synchronous, before the reply arrives.
    loop.markLaneGraphDirty(['5,5'], true);

    worker.reply({
      type: 'BATCH_RESULT',
      batchId: batchMsg!.batchId,
      results: [{ id: batchMsg!.requests[0]!.id, variants: [[0]] }],
    });

    expect(received).toHaveLength(0);
  });
});

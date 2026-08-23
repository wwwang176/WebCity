import { describe, it, expect } from 'vitest';
import { findGapAhead, findRedLightDistance, type LookaheadVehicle } from '../VehicleLookahead';
import type { LaneEdge, ConnectionPoint } from '../LaneGraph';
import { EdgeVehicleIndex, type EdgeVehicleView } from '../EdgeVehicleIndex';

/**
 * fixture 用的殼:維持 `Map` 的寫法，底下建的是真的 `EdgeVehicleIndex`。
 *
 * 正式路徑走 `begin()` / `add()` / `finish()`（每幀重建，不配物件）。這裡包一層是
 * 為了讓斷言講「這條邊上有誰」，而不是講 CSR 的索引算術。
 */
class TestIndex extends EdgeVehicleIndex {
  private started = false;
  constructor(init?: Array<[string, EdgeVehicleView[]]>) {
    super();
    if (init) for (const [k, v] of init) this.set(k, v);
  }
  set(edgeId: string, entries: EdgeVehicleView[]): void {
    if (!this.started) { this.begin(); this.started = true; }
    for (const e of entries) this.add(edgeId, e.vid, e.progress, e.halfLen, e.queueing);
  }
}


// ── Helpers ──

function makePoint(cellKey: string, x = 0, y = 0): ConnectionPoint {
  return { id: `${cellKey}_0`, position: { x, y }, tangent: { tx: 1, ty: 0 }, cellKey, lane: 0, direction: 'east', type: 'exit' };
}

function makeEdge(id: string, fromCell: string, toCell: string, length: number): LaneEdge {
  return {
    id,
    from: makePoint(fromCell),
    to: makePoint(toCell),
    length,
    type: 'straight',
  };
}

function makeVehicle(overrides: Partial<LookaheadVehicle> & { id: number }): LookaheadVehicle {
  return { length: 0.22, edgeIndex: 0, edgeProgress: 0, ...overrides };
}

// ── findGapAhead ──

describe('findGapAhead', () => {
  it('returns Infinity when no other vehicles on the path', () => {
    const edges = [makeEdge('e1', 'A', 'B', 2.0)];
    const v = makeVehicle({ id: 1 });
    const idx = new TestIndex();
    idx.set('e1', [{ vid: 1, progress: 0, halfLen: 0.11, queueing: false }]);

    expect(findGapAhead(v, edges, idx)).toBe(Infinity);
  });

  it('returns gap to vehicle ahead on same edge', () => {
    const edges = [makeEdge('e1', 'A', 'B', 2.0)];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const idx = new TestIndex();
    idx.set('e1', [
      { vid: 1, progress: 0, halfLen: 0.11, queueing: false },
      { vid: 2, progress: 1.0, halfLen: 0.11, queueing: false },
    ]);

    // gap = (1.0 - 0) - 0.11 - 0.11 = 0.78
    expect(findGapAhead(v, edges, idx)).toBeCloseTo(0.78, 5);
  });

  it('returns gap to vehicle on a future edge', () => {
    const edges = [
      makeEdge('e1', 'A', 'B', 1.0),
      makeEdge('e2', 'B', 'C', 1.0),
    ];
    const v = makeVehicle({ id: 1, edgeIndex: 0, edgeProgress: 0.5 });
    const idx = new TestIndex();
    idx.set('e1', [{ vid: 1, progress: 0.5, halfLen: 0.11, queueing: false }]);
    idx.set('e2', [{ vid: 2, progress: 0.3, halfLen: 0.11, queueing: false }]);

    // distAhead after e1 = 1.0 - 0.5 = 0.5
    // gap = 0.5 + 0.3 - 0.11 - 0.11 = 0.58
    expect(findGapAhead(v, edges, idx)).toBeCloseTo(0.58, 5);
  });

  it('picks the closest vehicle when multiple are ahead', () => {
    const edges = [makeEdge('e1', 'A', 'B', 3.0)];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const idx = new TestIndex();
    idx.set('e1', [
      { vid: 1, progress: 0, halfLen: 0.11, queueing: false },
      { vid: 2, progress: 1.0, halfLen: 0.11, queueing: false },
      { vid: 3, progress: 2.0, halfLen: 0.11, queueing: false },
    ]);

    // closest = vid 2 at 1.0: gap = 1.0 - 0.11 - 0.11 = 0.78
    expect(findGapAhead(v, edges, idx)).toBeCloseTo(0.78, 5);
  });

  it('ignores vehicles behind (lower progress)', () => {
    const edges = [makeEdge('e1', 'A', 'B', 3.0)];
    const v = makeVehicle({ id: 2, edgeProgress: 1.5 });
    const idx = new TestIndex();
    idx.set('e1', [
      { vid: 1, progress: 0.5, halfLen: 0.11, queueing: false },
      { vid: 2, progress: 1.5, halfLen: 0.11, queueing: false },
    ]);

    expect(findGapAhead(v, edges, idx)).toBe(Infinity);
  });
});

describe('findGapAhead 的提前收工', () => {
  /**
   * 找的是**最近**的那一台。找到之後，再往前的邊上不可能有更近的 —— 除非那台車
   * 比較長:空隙扣的是兩台車的半個車身，公車的車身是小客車的兩倍多。
   *
   * 所以提前收工的門檻要用路上最長的那台算。用眼前這台的長度算的話，一台停在
   * 更後面的公車會被跳過，而它留下的空隙其實更小 —— 車就這樣開進公車尾巴。
   */
  it('should still find a longer vehicle further along that leaves a smaller gap', () => {
    const edges = [makeEdge('e1', 'A', 'B', 1.0), makeEdge('e2', 'B', 'C', 1.0)];
    const idx = new TestIndex([
      ['e1', [{ vid: 2, progress: 0.9, halfLen: 0.11, queueing: false }]],   // 小客車:空隙 0.68
      ['e2', [{ vid: 3, progress: 0.0, halfLen: 0.30, queueing: false }]],   // 公車:空隙 0.59
    ]);
    const v = makeVehicle({ id: 1 });

    expect(findGapAhead(v, edges, idx, 0.30), '提前收工，漏掉了空隙更小的公車')
      .toBeCloseTo(0.59, 5);
  });

  it('should agree with the exhaustive scan', () => {
    // 提前收工不能改變答案。不給最長車身時不收工 —— 兩個結果要一樣。
    const edges = [
      makeEdge('e1', 'A', 'B', 1.0), makeEdge('e2', 'B', 'C', 1.0),
      makeEdge('e3', 'C', 'D', 1.0), makeEdge('e4', 'D', 'E', 1.0),
    ];
    const idx = new TestIndex([
      ['e2', [{ vid: 2, progress: 0.4, halfLen: 0.11, queueing: false }]],
      ['e3', [{ vid: 3, progress: 0.1, halfLen: 0.30, queueing: false }]],
    ]);
    const v = makeVehicle({ id: 1, edgeProgress: 0.5 });

    expect(findGapAhead(v, edges, idx, 0.30), '提前收工改變了答案')
      .toBeCloseTo(findGapAhead(v, edges, idx), 10);
  });
});

// ── findRedLightDistance ──

describe('findRedLightDistance', () => {
  it('returns Infinity when all lights are green', () => {
    const edges = [
      makeEdge('e1', 'A', 'B', 1.0),
      makeEdge('e2', 'B', 'C', 1.0),
    ];
    const v = makeVehicle({ id: 1 });
    const canAdvance = () => true;

    expect(findRedLightDistance(v, edges, canAdvance)).toBe(Infinity);
  });

  it('returns distance to red light on the first cross-cell edge', () => {
    const edges = [
      makeEdge('e1', 'A', 'B', 1.0),
      makeEdge('e2', 'B', 'C', 1.0),
    ];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const canAdvance = (from: string, to: string) => from === to || (from === 'A' && to === 'B');

    // e1 crosses A→B: canAdvance returns true
    // e2 crosses B→C: canAdvance returns false
    // distAhead after e1 = 1.0, stopDist = 1.0 - 0 = 1.0
    // result = max(0, 1.0 - 0.11 - 0.25) = 0.64  (STOP_LINE_OFFSET = 0.25)
    expect(findRedLightDistance(v, edges, canAdvance)).toBeCloseTo(0.64, 5);
  });

  it('returns 0 when red light is immediately ahead', () => {
    const edges = [makeEdge('e1', 'A', 'B', 0.05)];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const canAdvance = () => false;

    // stopDist = 0 - 0 = 0, result = max(0, 0 - 0.11) = 0
    expect(findRedLightDistance(v, edges, canAdvance)).toBe(0);
  });

  it('lets vehicle already crossing an intersection complete the crossing', () => {
    const edges = [
      makeEdge('e1', 'A', 'B', 1.0),  // cross-cell edge
      makeEdge('e2', 'B', 'C', 1.0),
    ];
    // Vehicle is already partway through e1 (entered when light was green)
    const v = makeVehicle({ id: 1, edgeIndex: 0, edgeProgress: 0.5 });
    // Light turns red for A→B
    const canAdvance = () => false;

    // e1 A→B: vehicle has progress > 0, so it should NOT be stopped
    // e2 B→C: canAdvance returns false → red
    // distAhead after e1 = 1.0 - 0.5 = 0.5, stopDist = 0.5 - 0 = 0.5
    // result = max(0, 0.5 - 0.11 - 0.25) = 0.14
    expect(findRedLightDistance(v, edges, canAdvance)).toBeCloseTo(0.14, 5);
  });

  it('stops vehicle at current edge if it has not started crossing', () => {
    const edges = [makeEdge('e1', 'A', 'B', 1.0)];
    // Vehicle has NOT started crossing (edgeProgress = 0)
    const v = makeVehicle({ id: 1, edgeIndex: 0, edgeProgress: 0 });
    const canAdvance = () => false;

    // e1 A→B: edgeProgress === 0, so it SHOULD be stopped
    expect(findRedLightDistance(v, edges, canAdvance)).toBe(0);
  });

  it('ignores edges within the same cell', () => {
    const edges = [
      makeEdge('e1', 'A', 'A', 0.5),  // same cell — no light check
      makeEdge('e2', 'A', 'B', 1.0),
    ];
    const v = makeVehicle({ id: 1 });
    const canAdvance = () => false;

    // e1 same cell → skip, e2 A→B → red
    // distAhead after e1 = 0.5, stopDist = 0.5 - 0 = 0.5
    // result = max(0, 0.5 - 0.11 - 0.25) = 0.14  (STOP_LINE_OFFSET = 0.25)
    expect(findRedLightDistance(v, edges, canAdvance)).toBeCloseTo(0.14, 5);
  });
});

// BUG-058: cross-intersection turn edges jump from the approach cell straight to
// the departure cell and record the skipped intersection only in viaCellKey.
// findRedLightDistance never forwarded it, so canAdvance was asked about two
// plain road tiles and turning vehicles sailed through red lights and closed
// level crossings.
describe('findRedLightDistance — cross-intersection turn edges', () => {
  function makeTurnEdge(id: string, fromCell: string, toCell: string, via: string, length: number): LaneEdge {
    return { ...makeEdge(id, fromCell, toCell, length), viaCellKey: via, type: 'turn' };
  }

  it('should pass viaCellKey to canAdvance for a turn edge', () => {
    const edges = [makeTurnEdge('xt:1', '2,3', '3,4', '3,3', 2.0)];
    const v = makeVehicle({ id: 1 });
    const seen: Array<[string, string, string | undefined]> = [];
    const canAdvance = (cur: string, next: string, via?: string) => {
      seen.push([cur, next, via]);
      return true;
    };

    findRedLightDistance(v, edges, canAdvance);

    expect(seen).toContainEqual(['2,3', '3,4', '3,3']);
  });

  it('should stop for a red light held at the via cell', () => {
    const edges = [makeTurnEdge('xt:1', '2,3', '3,4', '3,3', 2.0)];
    const v = makeVehicle({ id: 1 });
    // Only the intersection (3,3) is red; the departure tile is a plain road.
    const canAdvance = (_cur: string, _next: string, via?: string) => via !== '3,3';

    const dist = findRedLightDistance(v, edges, canAdvance);

    expect(dist).not.toBe(Infinity);
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  it('should leave straight edges unaffected (no via cell)', () => {
    const edges = [makeEdge('e1', '2,3', '3,3', 2.0)];
    const v = makeVehicle({ id: 1 });
    const seen: Array<string | undefined> = [];
    const canAdvance = (_cur: string, _next: string, via?: string) => {
      seen.push(via);
      return true;
    };

    findRedLightDistance(v, edges, canAdvance);
    expect(seen).toEqual([undefined]);
  });
});

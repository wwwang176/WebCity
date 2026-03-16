import { describe, it, expect } from 'vitest';
import { findGapAhead, findRedLightDistance, type EdgeEntry, type LookaheadVehicle } from '../VehicleLookahead';
import type { LaneEdge, ConnectionPoint } from '../LaneGraph';

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
    const idx = new Map<string, EdgeEntry[]>();
    idx.set('e1', [{ vid: 1, progress: 0, halfLen: 0.11 }]);

    expect(findGapAhead(v, edges, idx)).toBe(Infinity);
  });

  it('returns gap to vehicle ahead on same edge', () => {
    const edges = [makeEdge('e1', 'A', 'B', 2.0)];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const idx = new Map<string, EdgeEntry[]>();
    idx.set('e1', [
      { vid: 1, progress: 0, halfLen: 0.11 },
      { vid: 2, progress: 1.0, halfLen: 0.11 },
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
    const idx = new Map<string, EdgeEntry[]>();
    idx.set('e1', [{ vid: 1, progress: 0.5, halfLen: 0.11 }]);
    idx.set('e2', [{ vid: 2, progress: 0.3, halfLen: 0.11 }]);

    // distAhead after e1 = 1.0 - 0.5 = 0.5
    // gap = 0.5 + 0.3 - 0.11 - 0.11 = 0.58
    expect(findGapAhead(v, edges, idx)).toBeCloseTo(0.58, 5);
  });

  it('picks the closest vehicle when multiple are ahead', () => {
    const edges = [makeEdge('e1', 'A', 'B', 3.0)];
    const v = makeVehicle({ id: 1, edgeProgress: 0 });
    const idx = new Map<string, EdgeEntry[]>();
    idx.set('e1', [
      { vid: 1, progress: 0, halfLen: 0.11 },
      { vid: 2, progress: 1.0, halfLen: 0.11 },
      { vid: 3, progress: 2.0, halfLen: 0.11 },
    ]);

    // closest = vid 2 at 1.0: gap = 1.0 - 0.11 - 0.11 = 0.78
    expect(findGapAhead(v, edges, idx)).toBeCloseTo(0.78, 5);
  });

  it('ignores vehicles behind (lower progress)', () => {
    const edges = [makeEdge('e1', 'A', 'B', 3.0)];
    const v = makeVehicle({ id: 2, edgeProgress: 1.5 });
    const idx = new Map<string, EdgeEntry[]>();
    idx.set('e1', [
      { vid: 1, progress: 0.5, halfLen: 0.11 },
      { vid: 2, progress: 1.5, halfLen: 0.11 },
    ]);

    expect(findGapAhead(v, edges, idx)).toBe(Infinity);
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

import { describe, it, expect } from 'vitest';
import { interpolateEdgePosition, interpolateEdgeTangent } from '../EdgeInterpolation';
import type { LaneEdge } from '../LaneGraph';

/** Helper: create a minimal straight edge from (x1,y1) to (x2,y2). */
function straightEdge(x1: number, y1: number, x2: number, y2: number): LaneEdge {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    id: 'test',
    from: { nodeId: 'a', position: { x: x1, y: y1 }, direction: 'north', lane: 0 },
    to: { nodeId: 'b', position: { x: x2, y: y2 }, direction: 'south', lane: 0 },
    length: Math.sqrt(dx * dx + dy * dy),
    type: 'straight',
  };
}

/** Helper: create a curved edge with a single quadratic bezier control point. */
function curvedEdge(
  x1: number, y1: number, x2: number, y2: number,
  cp: { x: number; y: number },
): LaneEdge {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    id: 'test-curve',
    from: { nodeId: 'a', position: { x: x1, y: y1 }, direction: 'north', lane: 0 },
    to: { nodeId: 'b', position: { x: x2, y: y2 }, direction: 'south', lane: 0 },
    bezierControl: [cp],
    length: Math.sqrt(dx * dx + dy * dy),
    type: 'turn',
  };
}

describe('interpolateEdgePosition', () => {
  it('returns start position at t=0 for straight edge', () => {
    const edge = straightEdge(0, 0, 10, 0);
    const pos = interpolateEdgePosition(edge, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('returns end position at t=1 for straight edge', () => {
    const edge = straightEdge(0, 0, 10, 0);
    const pos = interpolateEdgePosition(edge, 1);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(0);
  });

  it('returns midpoint at t=0.5 for straight edge', () => {
    const edge = straightEdge(0, 0, 10, 20);
    const pos = interpolateEdgePosition(edge, 0.5);
    expect(pos.x).toBeCloseTo(5);
    expect(pos.y).toBeCloseTo(10);
  });

  it('returns start position at t=0 for curved edge', () => {
    const edge = curvedEdge(0, 0, 10, 0, { x: 5, y: 5 });
    const pos = interpolateEdgePosition(edge, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('returns end position at t=1 for curved edge', () => {
    const edge = curvedEdge(0, 0, 10, 0, { x: 5, y: 5 });
    const pos = interpolateEdgePosition(edge, 1);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(0);
  });

  it('returns curved midpoint (not linear) for bezier edge', () => {
    const edge = curvedEdge(0, 0, 10, 0, { x: 5, y: 10 });
    const pos = interpolateEdgePosition(edge, 0.5);
    // Quadratic Bezier midpoint with control point at (5,10) should have y > 0
    expect(pos.y).toBeGreaterThan(0);
  });
});

describe('interpolateEdgeTangent', () => {
  it('returns direction vector for straight edge', () => {
    const edge = straightEdge(0, 0, 10, 0);
    const tan = interpolateEdgeTangent(edge, 0.5);
    // Direction is (10, 0) — positive X
    expect(tan.x).toBeCloseTo(10);
    expect(tan.y).toBeCloseTo(0);
  });

  it('returns diagonal direction for diagonal straight edge', () => {
    const edge = straightEdge(0, 0, 3, 4);
    const tan = interpolateEdgeTangent(edge, 0);
    expect(tan.x).toBeCloseTo(3);
    expect(tan.y).toBeCloseTo(4);
  });

  it('returns tangent at t=0 pointing away from start for curved edge', () => {
    const edge = curvedEdge(0, 0, 10, 0, { x: 0, y: 10 });
    const tan = interpolateEdgeTangent(edge, 0);
    // At t=0, tangent = 2*(cp - p0) = 2*(0-0, 10-0) = (0, 20) — pointing up
    expect(tan.x).toBeCloseTo(0);
    expect(tan.y).toBeGreaterThan(0);
  });

  it('returns tangent at t=1 pointing towards end for curved edge', () => {
    const edge = curvedEdge(0, 0, 10, 0, { x: 0, y: 10 });
    const tan = interpolateEdgeTangent(edge, 1);
    // At t=1, tangent = 2*(p2 - cp) = 2*(10-0, 0-10) = (20, -20) — pointing right-down
    expect(tan.x).toBeGreaterThan(0);
    expect(tan.y).toBeLessThan(0);
  });

  it('constant tangent along straight edge (direction-independent of t)', () => {
    const edge = straightEdge(2, 3, 8, 7);
    const t0 = interpolateEdgeTangent(edge, 0);
    const t1 = interpolateEdgeTangent(edge, 0.5);
    const t2 = interpolateEdgeTangent(edge, 1);
    expect(t0.x).toBeCloseTo(t1.x);
    expect(t0.y).toBeCloseTo(t1.y);
    expect(t1.x).toBeCloseTo(t2.x);
    expect(t1.y).toBeCloseTo(t2.y);
  });
});

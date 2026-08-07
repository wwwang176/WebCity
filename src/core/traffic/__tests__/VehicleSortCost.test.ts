import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * The front-to-back sort called edgeTotalProgress from inside the comparator.
 * That function is an O(edgeIndex) prefix sum over the vehicle's edge path, so
 * the sort cost was O(N log N x L) rather than O(N log N + N x L) — at the
 * 2000-vehicle cap with paths tens of edges long, millions of iterations per
 * RENDER FRAME, since advanceEdgeVehicles runs off the frame loop rather than
 * the simulation tick (BUG-106).
 *
 * Counting `length` reads is a direct, machine-checkable proxy for that: with
 * the prefix sum hoisted it is linear in the path length, with it inside the
 * comparator it grows with log N on top.
 */
function edge(id: string, from: string, to: string, length: number): LaneEdge {
  let reads = 0;
  const point = (cellKey: string, x: number, type: 'entry' | 'exit') => ({
    id: `${cellKey}:${type}`,
    position: { x, y: 0 },
    tangent: { tx: 1, ty: 0 },
    cellKey,
    lane: 0,
    direction: 'east' as const,
    type,
  });
  const e = {
    id, length,
    from: point(from, 0, 'exit'),
    to: point(to, 1, 'entry'),
    type: 'straight' as const,
  } as unknown as LaneEdge;
  Object.defineProperty(e, 'length', {
    get() { reads++; return length; },
    configurable: true,
  });
  (e as unknown as { reads: () => number }).reads = () => reads;
  return e;
}

describe('vehicle sorting does not recompute prefix sums per comparison', () => {
  it('should read each edge length a bounded number of times', () => {
    const sim = new TrafficSimulation();
    const PATH_LEN = 12;
    const VEHICLES = 24;

    const edges: LaneEdge[] = [];
    for (let i = 0; i < PATH_LEN; i++) {
      edges.push(edge(`e${i}`, `${i},0`, `${i + 1},0`, 1));
    }

    for (let v = 0; v < VEHICLES; v++) {
      // addVehicleOnEdges returns the Vehicle itself, not an id.
      const vehicle = sim.addVehicleOnEdges(edges, v);
      // Park each vehicle near the end of its path so the prefix sum is long.
      vehicle.edgeIndex = PATH_LEN - 1;
    }

    sim.advanceEdgeVehicles(0.01, () => false);

    const totalReads = edges.reduce(
      (sum, e) => sum + (e as unknown as { reads: () => number }).reads(), 0,
    );

    // One prefix-sum pass per vehicle is ~VEHICLES * PATH_LEN reads. Doing it
    // inside the comparator multiplies that by log2(VEHICLES) ~ 4.6.
    const oncePerVehicle = VEHICLES * PATH_LEN;
    expect(totalReads).toBeLessThan(oncePerVehicle * 2);
  });
});

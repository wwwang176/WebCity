import { describe, it, expect } from 'vitest';
import { TrafficSimulation, type Vehicle } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * The front-to-back sort called edgeTotalProgress from inside the comparator.
 * That function is an O(edgeIndex) prefix sum over the vehicle's edge path, so
 * the sort cost was O(N log N x L) rather than O(N log N + N x L) — at the
 * 2000-vehicle cap with paths tens of edges long, millions of iterations per
 * RENDER FRAME, since advanceEdgeVehicles runs off the frame loop rather than
 * the simulation tick (BUG-106).
 *
 * This counts calls to edgeTotalProgress itself. The first version of the test
 * counted `length` property reads and allowed twice the expected total, which
 * left a discrimination margin of about 4% — well inside the noise of the other
 * length reads advanceEdgeVehicles makes. Hoisted, the call count is exactly
 * one per vehicle; from the comparator it is Theta(N log N) and unbounded above.
 */
function edge(id: string, from: string, to: string, length: number): LaneEdge {
  const point = (cellKey: string, x: number, type: 'entry' | 'exit') => ({
    id: `${cellKey}:${type}`,
    position: { x, y: 0 },
    tangent: { tx: 1, ty: 0 },
    cellKey,
    lane: 0,
    direction: 'east' as const,
    type,
  });
  return {
    id, length,
    from: point(from, 0, 'exit'),
    to: point(to, 1, 'entry'),
    type: 'straight' as const,
  } as unknown as LaneEdge;
}

describe('vehicle sorting does not recompute prefix sums per comparison', () => {
  it('should compute each vehicle progress exactly once per frame', () => {
    const sim = new TrafficSimulation();
    const PATH_LEN = 12;
    const VEHICLES = 64;

    const edges: LaneEdge[] = [];
    for (let i = 0; i < PATH_LEN; i++) {
      edges.push(edge(`e${i}`, `${i},0`, `${i + 1},0`, 1));
    }

    for (let v = 0; v < VEHICLES; v++) {
      // addVehicleOnEdges returns the Vehicle itself, not an id.
      const vehicle = sim.addVehicleOnEdges(edges, v);
      // Spread the vehicles along the path so the comparator sees distinct
      // totals and cannot short-circuit on equality.
      vehicle.edgeIndex = v % PATH_LEN;
    }

    let calls = 0;
    const priv = sim as unknown as { edgeTotalProgress(v: Vehicle): number };
    const orig = priv.edgeTotalProgress.bind(sim);
    priv.edgeTotalProgress = (v: Vehicle) => { calls++; return orig(v); };

    sim.advanceEdgeVehicles(0.01, () => false);

    expect(calls).toBe(VEHICLES);
  });

  it('should cache the same progress the comparator used to compute inline', () => {
    // The risk of hoisting a value out of a comparator is caching the wrong
    // one. The sort itself runs on a local array and is not observable from
    // outside, but the map it sorts by is — and it is the only thing the
    // ordering depends on.
    const sim = new TrafficSimulation();
    const edges = [edge('e0', '0,0', '1,0', 1), edge('e1', '1,0', '2,0', 1), edge('e2', '2,0', '3,0', 1)];

    const back = sim.addVehicleOnEdges(edges, 1);
    const front = sim.addVehicleOnEdges(edges, 2);
    back.edgeIndex = 0;
    back.edgeProgress = 0.25;
    front.edgeIndex = 2;
    front.edgeProgress = 0.5;

    sim.advanceEdgeVehicles(0.01, () => false);

    const progress = (sim as unknown as { sortProgress: Map<number, number> }).sortProgress;
    // back: no completed edges + 0.25. front: two 1-length edges + 0.5.
    expect(progress.get(back.id)).toBeCloseTo(0.25, 5);
    expect(progress.get(front.id)).toBeCloseTo(2.5, 5);
  });
});

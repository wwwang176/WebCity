import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * The per-frame "which vehicle is where on which edge" table is the sole basis for car
 * following. It is reallocated every frame, so freshness currently holds by construction; this
 * test guards **future** implementations. Pooling those entries to save hundreds of short-lived
 * objects per frame freezes a leader at its old position in the data if one field is missed,
 * and followers stop behind a vehicle that has long since driven away.
 *
 * Pooling was not kept: forgetting to update `vid` turns no test red, for 8.6% of a frame. This
 * test at least makes the frozen-position variant fail.
 */

function straight(n: number): LaneEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    from: {
      id: `p${i}`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `p${i + 1}`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight' as const,
  }));
}

describe('跟車讀到的是這一幀的位置', () => {
  it('should follow a leader that keeps driving away', () => {
    const sim = new TrafficSimulation();
    const route = straight(20);

    // Body type and speed variation are random; pinning them makes a failure reproducible.
    const pin = <T extends { length: number; speedMultiplier: number; stallTime: number }>(v: T): T => {
      v.length = 0.22; v.speedMultiplier = 1; v.stallTime = 0;
      return v;
    };
    const leader = sim.addVehicleOnEdges(route);
    pin(leader);
    leader.edgeProgress = 0.5;
    const follower = pin(sim.addVehicleOnEdges(route));

    for (let f = 0; f < 240; f++) sim.advanceEdgeVehicles(1 / 60);

    // The leader keeps driving away, so the follower should cover several edges. With positions
    // frozen at the first frame it sticks behind the phantom, around 0.2 cells in, never
    // leaving the first edge.
    expect(follower.edgeIndex, '停在一台其實早就開走的車後面')
      .toBeGreaterThan(2);
    expect(leader.edgeIndex, '前車自己也沒動 —— 這個案例失去意義')
      .toBeGreaterThan(follower.edgeIndex);
  });
});

import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * rebuildLaneGraph invalidated service vehicles because "their edgePaths
 * reference stale LaneEdges" — but the identical reasoning applies to commute
 * and freight vehicles, which were simply never handled. Buses have their own
 * onRoadChanged path; everything else kept driving along edges belonging to
 * demolished cells.
 *
 * Nothing rescued them: stallTime only accrues when a vehicle is blocked, and a
 * road that no longer exists blocks nothing, so they ran their whole path to
 * "arrival" in plain sight of the player (BUG-108).
 */
function point(cellKey: string, x: number, type: 'entry' | 'exit') {
  return {
    id: `${cellKey}:${type}`,
    position: { x, y: 0 },
    tangent: { tx: 1, ty: 0 },
    cellKey, lane: 0, direction: 'east' as const, type,
  };
}

function edge(from: string, to: string): LaneEdge {
  return {
    id: `${from}->${to}`, length: 1,
    from: point(from, 0, 'exit'), to: point(to, 1, 'entry'),
    type: 'straight',
  } as unknown as LaneEdge;
}

describe('vehicles are retired when the road under them changes', () => {
  it('should retire a vehicle whose remaining path crosses a changed cell', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges([edge('1,0', '2,0'), edge('2,0', '3,0'), edge('3,0', '4,0')], 1);

    const retired = sim.markVehiclesArrivedOnCells(new Set(['3,0']));

    expect(retired).toBe(1);
    expect(v.arrived).toBe(true);
  });

  it('should leave vehicles on untouched routes alone', () => {
    // BUG-054 made updateCells preserve edge identity outside the affected
    // cells, so untouched routes remain valid — culling them would be a
    // visible, pointless loss of traffic.
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges([edge('1,0', '2,0'), edge('2,0', '3,0')], 1);

    expect(sim.markVehiclesArrivedOnCells(new Set(['9,9']))).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should ignore cells the vehicle has already driven past', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges([edge('1,0', '2,0'), edge('2,0', '3,0'), edge('3,0', '4,0')], 1);
    v.edgeIndex = 2; // already on the last edge

    expect(sim.markVehiclesArrivedOnCells(new Set(['1,0']))).toBe(0);
    expect(v.arrived).toBe(false);
  });
});

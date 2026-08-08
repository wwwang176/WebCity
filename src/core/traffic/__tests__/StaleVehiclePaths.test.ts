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
 *
 * The question is asked by EDGE IDENTITY, not by cell key. Cell keys were an
 * approximation that missed a road DOWNGRADE (the cell still has a road; its
 * outer-lane edges are gone) and a demolish-then-relay inside one tick, and
 * that needed a separate wholesale sweep for the case where the changed set was
 * unknown — a sweep whose reasoning contradicted this one's.
 */
/** The ids of a set of edges, i.e. what the rebuilt graph would still own. */
function live(...edges: LaneEdge[]): Set<string> {
  return new Set(edges.map(e => e.id));
}

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
  it('should retire a vehicle whose remaining path lost an edge', () => {
    const sim = new TrafficSimulation();
    const a = edge('1,0', '2,0'), b = edge('2,0', '3,0'), c = edge('3,0', '4,0');
    const v = sim.addVehicleOnEdges([a, b, c], 1);

    // The rebuild kept a and b but not c.
    const retired = sim.retireVehiclesOnDeadEdges(live(a, b));

    expect(retired).toBe(1);
    expect(v.arrived).toBe(true);
  });

  it('should leave vehicles on untouched routes alone', () => {
    // BUG-054 made updateCells preserve edge identity outside the affected
    // cells, so untouched routes remain valid — culling them would be a
    // visible, pointless loss of traffic.
    const sim = new TrafficSimulation();
    const a = edge('1,0', '2,0'), b = edge('2,0', '3,0');
    const v = sim.addVehicleOnEdges([a, b], 1);

    expect(sim.retireVehiclesOnDeadEdges(live(a, b, edge('9,9', '9,10')))).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should never retire a bus', () => {
    // BusSystem.onRoadChanged owns bus vehicles and rewrites their edgePaths.
    // Retiring one here is unrecoverable: busVehicleIds and route.vehicles still
    // count it, and nothing reconciles them against traffic.vehicles, so the
    // route is left permanently without a vehicle (BUG-115).
    const sim = new TrafficSimulation();
    const path = [edge('1,0', '2,0'), edge('2,0', '3,0')];
    const bus = sim.addBusVehicle([path], 1);

    // Every edge gone, and the bus still survives.
    expect(sim.retireVehiclesOnDeadEdges(new Set())).toBe(0);
    expect(bus.arrived).toBe(false);
  });

  it('should never retire a service vehicle', () => {
    const sim = new TrafficSimulation();
    const v = sim.addServiceVehicle([edge('1,0', '2,0')], 'police');

    expect(sim.retireVehiclesOnDeadEdges(new Set())).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should ignore edges the vehicle has already driven past', () => {
    const sim = new TrafficSimulation();
    const a = edge('1,0', '2,0'), b = edge('2,0', '3,0'), c = edge('3,0', '4,0');
    const v = sim.addVehicleOnEdges([a, b, c], 1);
    v.edgeIndex = 2; // already on the last edge

    // a and b are gone, but the vehicle is past them.
    expect(sim.retireVehiclesOnDeadEdges(live(c))).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should retire a vehicle whose lane was removed by a road downgrade', () => {
    // The case the cell-key predicate could not see: the cell still carries a
    // road, so it never entered the removed set, but SIX_LANE -> TWO_LANE
    // deletes the lane-1 and lane-2 points and every edge on them.
    const sim = new TrafficSimulation();
    const lane0 = edge('1,0', '2,0');
    const lane2 = { ...edge('1,0', '2,0'), id: '1,0->2,0#lane2' } as LaneEdge;
    const v = sim.addVehicleOnEdges([lane2], 1);

    expect(sim.retireVehiclesOnDeadEdges(live(lane0))).toBe(1);
    expect(v.arrived).toBe(true);
  });
});

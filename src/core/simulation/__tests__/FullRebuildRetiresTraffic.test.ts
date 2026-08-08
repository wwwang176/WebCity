import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { PedestrianState } from '../../traffic/PedestrianAgent';

/**
 * BUG-108 retired vehicles whose route crossed a removed cell, and BUG-116
 * narrowed that to cells where the road is actually gone. Both live in the
 * branch that HAS a dirty-cell set.
 *
 * The other branch — a full rebuild, taken on save load, on the initial build,
 * and on any edit that reports no affected cells — replaces every LaneEdge
 * object in the graph and retired nothing at all. Live vehicles kept walking
 * edgePath arrays of orphaned edges, exactly the condition the incremental
 * branch exists to prevent.
 */
function cityWithTraffic() {
  const state = createGameState(30, 30);
  new RoadBuilder(state.grid).buildRoad({ x: 2, y: 5 }, { x: 25, y: 5 }, RoadType.TWO_LANE, 1e6);
  const loop = new SimulationLoop(state);
  loop.markLaneGraphDirty();
  loop.tick();
  return { state, loop };
}

/** Put a vehicle on the graph's current edges, as spawnCommuteVehicles would. */
function spawnOnGraph(state: ReturnType<typeof cityWithTraffic>['state'], loop: SimulationLoop) {
  const edges = loop.laneGraph.getAllEdges().slice(0, 4);
  expect(edges.length).toBeGreaterThan(0);
  return state.traffic.addVehicleOnEdges(edges, 1);
}

describe('a full lane-graph rebuild does not leave vehicles on orphaned edges', () => {
  it('should retire a commute vehicle when the whole graph is rebuilt', () => {
    const { state, loop } = cityWithTraffic();
    const v = spawnOnGraph(state, loop);
    expect(v.arrived).toBe(false);

    // No affected-cell set: the full-rebuild branch.
    loop.markLaneGraphDirty();
    loop.tick();

    expect(v.arrived).toBe(true);
  });

  it('should leave a bus alone — its own manager repaths it', () => {
    // Killing a bus here is unrecoverable: busVehicleIds and route.vehicles
    // still count it and nothing reconciles them (BUG-115).
    const { state, loop } = cityWithTraffic();
    const edges = loop.laneGraph.getAllEdges().slice(0, 4);
    const bus = state.traffic.addBusVehicle([edges], 1, 0);
    expect(bus.arrived).toBe(false);

    loop.markLaneGraphDirty();
    loop.tick();

    expect(bus.arrived).toBe(false);
  });

  it('should not retire traffic when only a few cells changed', () => {
    // Negative control for BUG-116: an incremental edit that adds road must not
    // fall through to the wholesale sweep.
    const { state, loop } = cityWithTraffic();
    const v = spawnOnGraph(state, loop);

    new RoadBuilder(state.grid).buildRoad({ x: 25, y: 5 }, { x: 25, y: 12 }, RoadType.TWO_LANE, 1e6);
    loop.markLaneGraphDirty(['25,6', '25,7', '25,8'], true);
    loop.tick();

    expect(v.arrived).toBe(false);
  });

  it('should retire pedestrians on a full rebuild too', () => {
    const { state, loop } = cityWithTraffic();
    const id = state.pedestrianManager.spawnPedestrian(3, 5, 20, 5, -1, 4);
    expect(id).not.toBeNull();
    const agent = state.pedestrianManager.agents.find(a => a.id === id)!;
    expect(agent.state).not.toBe(PedestrianState.ARRIVED);

    loop.markLaneGraphDirty();
    loop.tick();

    expect(agent.state).toBe(PedestrianState.ARRIVED);
  });

  it('should leave pedestrians alone for an incremental rebuild', () => {
    // Negative control, matching the vehicle case.
    const { state, loop } = cityWithTraffic();
    const id = state.pedestrianManager.spawnPedestrian(3, 5, 20, 5, -1, 4);
    const agent = state.pedestrianManager.agents.find(a => a.id === id)!;

    new RoadBuilder(state.grid).buildRoad({ x: 25, y: 5 }, { x: 25, y: 12 }, RoadType.TWO_LANE, 1e6);
    loop.markLaneGraphDirty(['25,6', '25,7', '25,8'], true);
    loop.tick();

    expect(agent.state).not.toBe(PedestrianState.ARRIVED);
  });
});

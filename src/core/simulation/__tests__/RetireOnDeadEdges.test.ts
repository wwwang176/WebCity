import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { PedestrianState } from '../../traffic/PedestrianAgent';

/**
 * A vehicle must be retired exactly when the graph no longer owns an edge on
 * its remaining path — no more, no less.
 *
 * Three approximations of that question were tried and each got a case wrong:
 *
 *  - "retire on any dirty cell" deleted the traffic already driving on a road
 *    that was merely extended or upgraded (BUG-116);
 *  - "retire where the road is gone" missed a DOWNGRADE. RoadBuilder writes the
 *    new tier unconditionally and clamps the cost at 0, so drawing TWO_LANE
 *    over SIX_LANE is free and deletes the lane-1 and lane-2 points along with
 *    every edge on them — leaving those vehicles driving off the road surface,
 *    and sharing no edge id with anything in the lookahead index, so they pass
 *    through oncoming traffic;
 *  - the wholesale full-rebuild sweep contradicted the first rule outright, and
 *    could not tell a NULL affected-set ("we don't know what changed") from an
 *    EMPTY one ("we know, and nothing did") — so dragging the demolish tool
 *    across bare grass deleted every car and pedestrian in the city.
 *
 * Edge ids are deterministic, so a rebuild that changes nothing produces the
 * same ids and retires nobody, and the full-vs-incremental distinction the
 * previous version needed disappears.
 */
function cityWithTraffic() {
  const state = createGameState(30, 30);
  new RoadBuilder(state.grid).buildRoad({ x: 2, y: 5 }, { x: 25, y: 5 }, RoadType.SIX_LANE, 1e6);
  const loop = new SimulationLoop(state);
  loop.markLaneGraphDirty();
  loop.tick();
  return { state, loop };
}

describe('vehicles are retired exactly when their edges die', () => {
  it('should keep a vehicle when a rebuild changes nothing', () => {
    // The case the wholesale sweep got wrong. Same roads in, same roads out.
    const { state, loop } = cityWithTraffic();
    const v = state.traffic.addVehicleOnEdges(loop.laneGraph.getAllEdges().slice(0, 4), 1);

    loop.markLaneGraphDirty();
    loop.tick();

    expect(v.arrived).toBe(false);
  });

  it('should keep a vehicle when the demolish drag hit only empty ground', () => {
    // Game.ts calls markLaneGraphDirty([...elevated, ...roads, ...buildings])
    // unconditionally, so a drag over bare grass yields an EMPTY set — which is
    // a statement that nothing changed, not an absence of information.
    const { state, loop } = cityWithTraffic();
    const v = state.traffic.addVehicleOnEdges(loop.laneGraph.getAllEdges().slice(0, 4), 1);

    loop.markLaneGraphDirty([], true);
    loop.tick();

    expect(v.arrived).toBe(false);
  });

  it('should keep a vehicle when the road it is on is extended', () => {
    const { state, loop } = cityWithTraffic();
    const v = state.traffic.addVehicleOnEdges(loop.laneGraph.getAllEdges().slice(0, 4), 1);

    new RoadBuilder(state.grid).buildRoad({ x: 25, y: 5 }, { x: 25, y: 12 }, RoadType.SIX_LANE, 1e6);
    loop.markLaneGraphDirty(['25,6', '25,7', '25,8'], true);
    loop.tick();

    expect(v.arrived).toBe(false);
  });

  it('should retire a vehicle whose road is demolished', () => {
    const { state, loop } = cityWithTraffic();
    const doomed = loop.laneGraph.getAllEdges()
      .filter(e => e.from.cellKey === '10,5' || e.to.cellKey === '10,5');
    expect(doomed.length).toBeGreaterThan(0);
    const v = state.traffic.addVehicleOnEdges(doomed.slice(0, 2), 1);

    new RoadBuilder(state.grid).removeRoad(10, 5);
    loop.markLaneGraphDirty(['10,5'], true);
    loop.tick();

    expect(v.arrived).toBe(true);
  });

  it('should retire a vehicle in a lane a DOWNGRADE deleted', () => {
    // Six lanes down to two, for free — the cost is clamped at 0. Every
    // cell-key predicate says "the road is still there"; the lane-1 and lane-2
    // edges are nonetheless gone.
    const { state, loop } = cityWithTraffic();
    const outer = loop.laneGraph.getAllEdges().filter(e => e.from.lane >= 1);
    expect(outer.length).toBeGreaterThan(0);
    const v = state.traffic.addVehicleOnEdges(outer.slice(0, 2), 1);

    const cells: string[] = [];
    for (let x = 2; x <= 25; x++) cells.push(`${x},5`);
    new RoadBuilder(state.grid).buildRoad({ x: 2, y: 5 }, { x: 25, y: 5 }, RoadType.TWO_LANE, 1e6);
    loop.markLaneGraphDirty(cells, true);
    loop.tick();

    expect(v.arrived).toBe(true);
  });

  it('should leave a bus alone — its own manager repaths it', () => {
    // Killing a bus here is unrecoverable: busVehicleIds and route.vehicles
    // still count it and nothing reconciles them (BUG-115).
    const { state, loop } = cityWithTraffic();
    const doomed = loop.laneGraph.getAllEdges()
      .filter(e => e.from.cellKey === '10,5' || e.to.cellKey === '10,5');
    const bus = state.traffic.addBusVehicle([doomed.slice(0, 2)], 1, 0);

    new RoadBuilder(state.grid).removeRoad(10, 5);
    loop.markLaneGraphDirty(['10,5'], true);
    loop.tick();

    expect(bus.arrived).toBe(false);
  });

  it('should keep a pedestrian when a rebuild changes nothing', () => {
    const { state, loop } = cityWithTraffic();
    state.grid.setCell(3, 4, { zoneType: 1, buildingId: 1 });
    state.grid.setCell(20, 4, { zoneType: 3, buildingId: 7 });
    loop.markLaneGraphDirty();
    loop.tick();

    const id = state.pedestrianManager.spawnPedestrian(3, 4, 20, 4, -1, 4);
    const agent = state.pedestrianManager.agents.find(a => a.id === id);
    expect(agent).toBeDefined();

    loop.markLaneGraphDirty();
    loop.tick();

    expect(agent!.state).not.toBe(PedestrianState.ARRIVED);
  });

  it('should retire a pedestrian whose pavement is demolished', () => {
    const { state, loop } = cityWithTraffic();
    state.grid.setCell(3, 4, { zoneType: 1, buildingId: 1 });
    state.grid.setCell(20, 4, { zoneType: 3, buildingId: 7 });
    loop.markLaneGraphDirty();
    loop.tick();

    const id = state.pedestrianManager.spawnPedestrian(3, 4, 20, 4, -1, 4);
    const agent = state.pedestrianManager.agents.find(a => a.id === id);
    expect(agent).toBeDefined();

    for (let x = 8; x <= 14; x++) new RoadBuilder(state.grid).removeRoad(x, 5);
    loop.markLaneGraphDirty();
    loop.tick();

    expect(agent!.state).toBe(PedestrianState.ARRIVED);
  });
});

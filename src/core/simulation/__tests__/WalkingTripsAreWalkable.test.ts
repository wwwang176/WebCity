import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';
import { getInfraBuildingId } from '../../building/InfraConfig';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { SIMULATION } from '../SimulationConstants';
import type { WalkingTripPool } from '../../traffic/PedestrianManager';
import { WALK_RANGE_BY_TYPE } from '../../transport/WalkRange';

/**
 * Every pedestrian dispatched can reach their destination.
 *
 * This is what the player actually sees: a stop across the road and a pedestrian walking the
 * long way round to it. The detour itself is correct (pedestrians only cross at junctions);
 * what is wrong is that the simulation sent them to that stop at all, because stop selection
 * measured a straight line and the far side is only two tiles away.
 *
 * These do not check for detours but for a stronger property: **every dispatched walk must
 * actually be walkable within the walk limit**. The unwalkable ones are exactly the
 * pedestrians who either loop around or never appear.
 */

const HOME_Y = 9;
const ROAD_Y = 10;
const STOP_Y = 11;

/**
 * One east-west arterial with junctions only at its ends. Homes are all north of it and bus
 * stops all south, so every household is "two tiles from a stop" by straight line while
 * actually having to reach a junction at the map edge to cross.
 */
function cityWithStopsAcrossTheRoad(): GameState {
  const W = 24;
  const state = createGameState(W, W);

  for (let x = 0; x < W; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < W - 1) flags |= RoadDirection.EAST;
    if (x === 0 || x === W - 1) flags |= RoadDirection.NORTH | RoadDirection.SOUTH;
    state.grid.setCell(x, ROAD_Y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  // North-south links at both ends, creating the only two junctions.
  for (const x of [0, W - 1]) {
    for (let y = HOME_Y - 2; y <= STOP_Y + 2; y++) {
      if (y === ROAD_Y) continue;
      let flags = RoadDirection.NORTH | RoadDirection.SOUTH;
      state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }

  const homes: string[] = [];
  const works: string[] = [];
  for (let x = 3; x < W - 3; x += 2) {
    state.grid.setCell(x, HOME_Y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    homes.push(`${x},${HOME_Y}`);
    state.grid.setCell(x, HOME_Y - 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    works.push(`${x},${HOME_Y - 1}`);
  }

  // All stops south of the road.
  const busId = getInfraBuildingId('bus_stop');
  const stops = [4, 12, 19].map(x => {
    state.grid.setCell(x, STOP_Y, { buildingId: busId });
    return state.bus.addStop(x, STOP_Y);
  });
  state.bus.createRoute(stops, 2);

  for (let n = 0; n < 40; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % homes.length]!;
    c.workplaceId = works[(n + 3) % works.length]!;
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function tripPoolOf(loop: SimulationLoop): WalkingTripPool {
  return (loop as unknown as { walkingTripPool: WalkingTripPool }).walkingTripPool;
}

describe('派出去的步行都走得到', () => {
  it('should produce some walking trips at all', () => {
    // Control: with the stops moved north of the road, onto the homes' side, pedestrians
    // really should be dispatched.
    const state = cityWithStopsAcrossTheRoad();
    for (const s of state.bus.getStops()) {
      state.grid.setCell(s.x, s.y, { buildingId: 0 });
      s.y = HOME_Y + 0; // move to the homes' side
      state.grid.setCell(s.x, s.y, { buildingId: getInfraBuildingId('bus_stop') });
    }
    const loop = makeLoop(state);
    for (let i = 0; i < 40; i++) loop.tick();

    expect(
      tripPoolOf(loop).trips.length,
      '一條行人都沒派出去，下面那條測試等於沒測',
    ).toBeGreaterThan(0);
  });

  it('should never dispatch a walk that cannot be walked', () => {
    const state = cityWithStopsAcrossTheRoad();
    const loop = makeLoop(state);
    for (let i = 0; i < 40; i++) loop.tick();

    const reach = new SidewalkStopReach(state.sidewalkGraph);
    const limit = WALK_RANGE_BY_TYPE.WIDEST;

    for (const trip of tripPoolOf(loop).trips) {
      const walkable = reach.cellsWithin(trip.fromX, trip.fromY, limit)
        .get(`${trip.toX},${trip.toY}`);
      expect(
        walkable,
        `行人被派去走 (${trip.fromX},${trip.fromY}) → (${trip.toX},${trip.toY})，`
        + `但沿人行道在 ${limit} 格內走不到 —— 他會繞到地圖邊緣的路口再繞回來`,
      ).toBeDefined();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { getInfraBuildingId } from '../../building/InfraConfig';

/**
 * A newly placed stop must enter the sidewalk graph immediately.
 *
 * In the graph a stop is the four door nodes of a 1x1 building: pedestrians enter through
 * them, and the stop's catchment is measured outwards from them. With no door nodes, the stop
 * serves nobody.
 *
 * The sidewalk graph's dirty flag is set only by `markLaneGraphDirty`, which placing a transit
 * facility deliberately does not call (a facility does not change the road network, and
 * dragging the lane graph and commute cache into a rebuild with it is too expensive). Without
 * this path the stop is locked out until the player happens to edit a road.
 */

function cityWithRoad(): GameState {
  const state = createGameState(20, 20);
  for (let x = 0; x < 20; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < 19) flags |= RoadDirection.EAST;
    state.grid.setCell(x, 10, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function doorsAt(state: GameState, x: number, y: number): number {
  return state.sidewalkGraph.getNodesInCell(`${x},${y}`)
    .filter(n => n.type === 'building_entrance').length;
}

describe('新蓋的站牌與人行道圖', () => {
  it('should have no doors before anything is built there', () => {
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();
    expect(doorsAt(state, 5, 11), '什麼都還沒蓋就有門，這條測試等於沒測').toBe(0);
  });

  it('should give a freshly placed bus stop its doors right away', () => {
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();

    state.bus.addStop(5, 11);
    state.grid.setCell(5, 11, { buildingId: getInfraBuildingId('bus_stop') });
    loop.applyBuildingChange(['5,11']);

    expect(
      doorsAt(state, 5, 11),
      '站牌沒有進人行道圖 —— 它服務不到任何人，行人也走不進去',
    ).toBeGreaterThan(0);
  });

  it('should connect the new stop to the pavement beside it', () => {
    // Doors alone are not enough: they must connect to the pavement of the road beside them,
    // or nobody can reach the stop either.
    const state = cityWithRoad();
    const loop = makeLoop(state);
    loop.ensureSidewalkGraph();

    state.grid.setCell(5, 11, { buildingId: getInfraBuildingId('bus_stop') });
    loop.applyBuildingChange(['5,11']);

    const doors = state.sidewalkGraph.getNodesInCell('5,11')
      .filter(n => n.type === 'building_entrance');
    const linked = doors.some(d =>
      state.sidewalkGraph.getEdgesFrom(d.id).some(e => e.type === 'building_access'));

    expect(linked, '站牌的門沒有接上任何人行道').toBe(true);
  });
});

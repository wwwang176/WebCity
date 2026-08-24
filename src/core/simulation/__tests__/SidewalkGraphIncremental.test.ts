import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import type { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { WALK_RANGE_BY_TYPE } from '../../transport/WalkRange';

/**
 * Editing one road cell recomputes only the sidewalks near it.
 *
 * `buildFromGrid` discards every node and edge of the graph and regenerates it: measured at
 * 80-130ms on a fully paved 60x60 map, triggered by every single road edit, which is the
 * stutter felt while dragging a road.
 *
 * Whether a rebuild happened is checked by node **object identity**: a full rebuild produces
 * new node objects, while an incremental update leaves untouched ones as they were.
 */

function gridCity(size = 24): GameState {
  const state = createGameState(size, size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i % 6 !== 0 && j % 6 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 6 === 0) flags |= RoadDirection.NORTH;
      if (j < size - 1 && i % 6 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 6 === 0) flags |= RoadDirection.WEST;
      if (i < size - 1 && j % 6 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  // Buildings along the roads, so the graph has door nodes.
  for (let i = 1; i < size; i += 6) {
    for (let j = 1; j < size; j += 6) {
      state.grid.setCell(i, j, { buildingId: 1 });
    }
  }
  return state;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  loop.ensureSidewalkGraph();
  return loop;
}

/** The id of some node far from the edit that is certain to exist. */
function farNodeId(state: GameState): string {
  // A crossroads with road on all four sides has no sidewalk node, so pick a straight stretch.
  const node = state.sidewalkGraph.getNodesInCell('18,17')[0];
  expect(node, '測試佈局挑不到遠處的節點').toBeDefined();
  return node!.id;
}

describe('人行道圖的增量重建', () => {
  it('should keep untouched nodes as the very same objects', () => {
    const state = gridCity();
    const loop = makeLoop(state);
    const id = farNodeId(state);
    const before = state.sidewalkGraph.getNode(id);

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(
      state.sidewalkGraph.getNode(id),
      '改一格道路就把全圖的節點重建了一次',
    ).toBe(before);
  });

  it('should still fold the edited cell in', () => {
    // Incremental must not become "did nothing": the edited cell has to grow sidewalk nodes.
    const state = gridCity();
    const loop = makeLoop(state);
    expect(state.sidewalkGraph.getNodesInCell('1,3'), '這一格一開始就有節點，測試等於沒測')
      .toHaveLength(0);

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(state.sidewalkGraph.getNodesInCell('1,3').length, '新鋪的路沒有人行道')
      .toBeGreaterThan(0);
  });

  it('should not wipe the whole pedestrian path cache on an incremental update', () => {
    // After a full rebuild no cached walking path can be trusted, so the cache is cleared. An
    // incremental update only kills routes near the edit, which `invalidateCells` has already
    // dropped precisely. Clearing everything forces a storm of multi-target A*, which is the
    // cost being removed here.
    const state = gridCity();
    const loop = makeLoop(state);
    let cleared = 0;
    state.pedestrianManager.clearPathCache = () => { cleared++; };

    state.grid.setCell(1, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0 });
    loop.markLaneGraphDirty(['1,3'], true);
    loop.ensureSidewalkGraph();

    expect(cleared, '增量更新把整份步行路徑快取清光了').toBe(0);
  });

  it('should keep stop coverage a distant building change cannot affect', () => {
    // `applyBuildingChange` runs on every building the developers add or remove, the highest
    // frequency change in the game. It advances the sidewalk graph's generation, and a
    // generation change makes the stop-walk-range safety net discard the whole cache, so the
    // cache would never survive a growth tick and the design would be pointless. Invalidation
    // therefore has to be precise.
    const state = gridCity();
    const loop = makeLoop(state);
    const reach = (loop as unknown as { stopReach: SidewalkStopReach }).stopReach;
    const far = reach.cellsWithin(1, 1, 5);

    state.grid.setCell(19, 19, { buildingId: 1 });
    loop.applyBuildingChange(['19,19']);

    expect(
      reach.cellsWithin(1, 1, 5),
      '遠處蓋了一棟房子，全城站牌的步行範圍都被丟掉重算',
    ).toBe(far);
  });

  it('should invalidate stop coverage as far out as the widest walk range', () => {
    // The invalidation radius has to cover the widest transport type, not one particular
    // type's limit. A narrower radius leaves stops between 5 and 8 tiles with stale coverage.
    const state = gridCity();
    const loop = makeLoop(state);
    const reach = (loop as unknown as { stopReach: SidewalkStopReach }).stopReach;
    const stale = reach.cellsWithin(1, 1, WALK_RANGE_BY_TYPE.WIDEST);

    // 7 tiles away: past the bus limit, inside the metro one.
    state.grid.setCell(8, 1, { buildingId: 1 });
    loop.applyBuildingChange(['8,1']);

    expect(
      reach.cellsWithin(1, 1, WALK_RANGE_BY_TYPE.WIDEST),
      '七格外的改動沒有讓這個站牌重算 —— 捷運的涵蓋範圍過期了',
    ).not.toBe(stale);
  });

  it('should rebuild everything when no cells are named', () => {
    // Cases where nothing is known about what changed, such as loading a save, still take the
    // full rebuild.
    const state = gridCity();
    const loop = makeLoop(state);
    const id = farNodeId(state);
    const before = state.sidewalkGraph.getNode(id);

    loop.markLaneGraphDirty();
    loop.ensureSidewalkGraph();

    expect(state.sidewalkGraph.getNode(id), '沒有指名格子時應該全量重建').not.toBe(before);
  });
});

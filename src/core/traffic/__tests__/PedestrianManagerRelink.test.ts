import { describe, it, expect } from 'vitest';
import { SidewalkGraph } from '../SidewalkGraph';
import { PedestrianManager } from '../PedestrianManager';
import { PedestrianTripType } from '../PedestrianAgent';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * rebuildSidewalkGraph used to replace state.pedestrianManager with a brand new
 * instance, discarding every walking pedestrian, the whole path cache, and the
 * levelCrossings wiring. markLaneGraphDirty always sets sidewalkGraphDirty, and
 * it fires on road build, road demolish, any other demolish, and on rezoning
 * over existing buildings — so every one of those edits made the pedestrians on
 * screen vanish (BUG-104).
 *
 * Keeping the instance then makes the cached-null-path defect reachable: a
 * failed lookup caches null, and a null entry has no edges to index, so
 * invalidateCells could never evict it (BUG-103).
 */
function graphFor(cells: string[]): SidewalkGraph {
  const graph = new SidewalkGraph();
  const lookup = {
    getCell: (x: number, y: number) => {
      const k = toPosKey(x, y);
      return cells.includes(k)
        ? { roadType: 2, roadFlags: 12, railType: 0, buildingId: 0 }
        : null;
    },
  };
  graph.buildFromGrid(lookup, cells, []);
  return graph;
}

describe('PedestrianManager survives a sidewalk graph rebuild', () => {
  const road = Array.from({ length: 10 }, (_, i) => toPosKey(i, 5));

  it('should keep its agents when the graph is relinked', () => {
    const pm = new PedestrianManager(graphFor(road));
    pm.spawnPedestrian(1, 5, 8, 5, 1, PedestrianTripType.FULL_WALK);
    const before = pm.agents.length;
    expect(before).toBeGreaterThan(0);

    pm.setSidewalkGraph(graphFor(road));

    expect(pm.agents.length).toBe(before);
  });

  it('should retire agents whose remaining route crosses a removed cell', () => {
    // The mirror of the vehicle sweep. Keeping agents across a rebuild stopped
    // them vanishing, but buildFromGrid replaces every node and edge, so an
    // agent's edgePath describes pavement that no longer exists — and tick()
    // never re-queries the graph. Pedestrians have no stallTime to save them
    // (BUG-124).
    const pm = new PedestrianManager(graphFor(road));
    pm.spawnPedestrian(1, 5, 8, 5, 1, PedestrianTripType.FULL_WALK);
    expect(pm.agents.length).toBeGreaterThan(0);

    const retired = pm.markAgentsArrivedOnCells(new Set([toPosKey(5, 5)]));

    expect(retired).toBeGreaterThan(0);
  });

  it('should leave agents on untouched routes walking', () => {
    const pm = new PedestrianManager(graphFor(road));
    pm.spawnPedestrian(1, 5, 8, 5, 1, PedestrianTripType.FULL_WALK);

    expect(pm.markAgentsArrivedOnCells(new Set([toPosKey(19, 19)]))).toBe(0);
  });
});

describe('failed pedestrian paths can be invalidated', () => {
  it('should re-evaluate a route after the cells it failed on change', () => {
    // Two disconnected stubs: no route exists, so null is cached.
    const disconnected = [toPosKey(1, 5), toPosKey(2, 5), toPosKey(8, 5), toPosKey(9, 5)];
    const graph = graphFor(disconnected);
    const pm = new PedestrianManager(graph);
    expect(pm.spawnPedestrian(1, 5, 9, 5, 1, PedestrianTripType.FULL_WALK)).toBeFalsy();

    // Fill the gap IN PLACE, so the manager keeps its cache — this is what an
    // ordinary road build does. setSidewalkGraph would clear the cache wholesale
    // and hide the defect.
    const full = Array.from({ length: 10 }, (_, i) => toPosKey(i, 5));
    graph.buildFromGrid({
      getCell: (x: number, y: number) => (full.includes(toPosKey(x, y))
        ? { roadType: 2, roadFlags: 12, railType: 0, buildingId: 0 } : null),
    }, full, []);
    pm.invalidateCells([toPosKey(1, 5), toPosKey(9, 5)]);

    expect(pm.spawnPedestrian(1, 5, 9, 5, 1, PedestrianTripType.FULL_WALK)).toBeTruthy();
  });
});

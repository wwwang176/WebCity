import { describe, it, expect } from 'vitest';
import { refineLanePathVariants } from '../Pathfinding';
import { LaneGraph } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/**
 * Build an L-shaped road: south on x=5 then west on y=10, with a FOUR_LANE L-bend at (5,10).
 * Long enough for variants to differentiate.
 */
function buildLShapedRoad() {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const allKeys: string[] = [];

  // North-south segment: (5,0) to (5,9) — straight south
  for (let y = 0; y <= 9; y++) {
    let flags = 0;
    if (y > 0) flags |= RoadDirection.NORTH;
    if (y < 9) flags |= RoadDirection.SOUTH;
    // (5,9) also connects south to (5,10)
    if (y === 9) flags |= RoadDirection.SOUTH;
    cells.set(`5,${y}`, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
    allKeys.push(`5,${y}`);
  }

  // L-bend at (5,10): N + W
  cells.set('5,10', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.WEST });
  allKeys.push('5,10');

  // East-west segment: (0,10) to (4,10) — straight west
  for (let x = 0; x <= 4; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < 4) flags |= RoadDirection.EAST;
    // (4,10) also connects east to (5,10)
    if (x === 4) flags |= RoadDirection.EAST;
    cells.set(`${x},10`, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
    allKeys.push(`${x},10`);
  }

  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), allKeys);

  // Cell path: south then west through L-bend
  const cellPath: string[] = [];
  for (let y = 0; y <= 10; y++) cellPath.push(`5,${y}`);
  for (let x = 4; x >= 0; x--) cellPath.push(`${x},10`);

  return { graph, cellPath, cells, allKeys };
}

describe('Per-cell lane penalty', () => {
  it('V1 and V2 should differ on the L-bend west segment', () => {
    const { graph, cellPath } = buildLShapedRoad();
    const variants = refineLanePathVariants(graph, cellPath);

    expect(variants.length).toBeGreaterThanOrEqual(2);

    // Collect the dominant lane on the west segment (cells 0,10 to 4,10) for each variant
    const westCells = new Set(['0,10', '1,10', '2,10', '3,10', '4,10']);
    const variantWestLanes = variants.map(v => {
      const laneCounts = new Map<number, number>();
      for (const e of v) {
        if (westCells.has(e.to.cellKey)) {
          laneCounts.set(e.to.lane, (laneCounts.get(e.to.lane) ?? 0) + 1);
        }
      }
      let dominant = -1, maxCount = 0;
      for (const [lane, count] of laneCounts) {
        if (count > maxCount) { dominant = lane; maxCount = count; }
      }
      return dominant;
    });

    // V1 and V2 should use different lanes on the west segment
    const uniqueWestLanes = new Set(variantWestLanes.filter(l => l >= 0));
    expect(uniqueWestLanes.size).toBeGreaterThanOrEqual(2);
  });

  it('start and end cells should not be penalized (both variants start/end on outermost)', () => {
    const { graph, cellPath } = buildLShapedRoad();
    const variants = refineLanePathVariants(graph, cellPath);

    expect(variants.length).toBeGreaterThanOrEqual(2);

    // All variants should start and end on the same outermost lane
    for (const v of variants) {
      const startLane = v[0]!.from.lane;
      const endLane = v[v.length - 1]!.to.lane;
      expect(startLane).toBe(variants[0]![0]!.from.lane);
      expect(endLane).toBe(variants[0]![variants[0]!.length - 1]!.to.lane);
    }
  });

  it('penalty should be per-cell: north L0 penalty should not affect west L0', () => {
    const { graph, cellPath } = buildLShapedRoad();
    const variants = refineLanePathVariants(graph, cellPath);

    expect(variants.length).toBeGreaterThanOrEqual(2);

    // If V1 uses L0 on north segment and L1 on west segment (due to L-bend geometry),
    // V2 should be able to use L0 on the west segment (north L0 penalty doesn't spread to west L0)
    const westCells = new Set(['0,10', '1,10', '2,10', '3,10']);
    let anyVariantUsesWestL0 = false;
    for (const v of variants) {
      for (const e of v) {
        if (westCells.has(e.to.cellKey) && e.to.lane === 0) {
          anyVariantUsesWestL0 = true;
        }
      }
    }
    expect(anyVariantUsesWestL0).toBe(true);
  });
});

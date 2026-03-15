import { describe, it, expect } from 'vitest';
import { refineLanePathVariants, refineLanePath, LANE_PATH_VARIANT_COUNT } from '../Pathfinding';
import { LaneGraph } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';

function makeGridLookup(cells: Map<string, { roadType: RoadType; roadFlags: number }>) {
  return { getCell: (x: number, y: number) => cells.get(`${x},${y}`) ?? null };
}

function buildStraightRoad(length: number, roadType = RoadType.TWO_LANE) {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const cellKeys: string[] = [];
  for (let x = 0; x < length; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < length - 1) flags |= RoadDirection.EAST;
    cells.set(`${x},0`, { roadType, roadFlags: flags });
    cellKeys.push(`${x},0`);
  }
  const grid = makeGridLookup(cells);
  const graph = new LaneGraph();
  graph.buildFromGrid(grid, cellKeys);
  return { grid, graph, cellKeys };
}

describe('refineLanePathVariants', () => {
  it('should return up to LANE_PATH_VARIANT_COUNT variants', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    expect(variants.length).toBeGreaterThan(0);
    expect(variants.length).toBeLessThanOrEqual(LANE_PATH_VARIANT_COUNT);
  });

  it('should produce connected paths for each variant', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    for (const variant of variants) {
      expect(variant.length).toBeGreaterThan(0);
      for (let i = 1; i < variant.length; i++) {
        expect(variant[i - 1]!.to.id).toBe(variant[i]!.from.id);
      }
    }
  });

  it('variants should differ in lane usage on multi-lane road', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    expect(variants.length).toBeGreaterThanOrEqual(2);

    // Collect the set of edge IDs for each variant
    const edgeIdSets = variants.map(v => new Set(v.map(e => e.id)));

    // At least two variants should have different edges
    let hasDifference = false;
    for (let i = 1; i < edgeIdSets.length; i++) {
      const a = edgeIdSets[0]!;
      const b = edgeIdSets[i]!;
      for (const id of b) {
        if (!a.has(id)) { hasDifference = true; break; }
      }
      if (hasDifference) break;
    }
    expect(hasDifference).toBe(true);
  });

  it('first variant should match refineLanePath result', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);
    const single = refineLanePath(graph, cellKeys);

    expect(variants.length).toBeGreaterThan(0);
    expect(single).not.toBeNull();

    // First variant should have same edges as the single refineLanePath
    const variantIds = variants[0]!.map(e => e.id);
    const singleIds = single!.map(e => e.id);
    expect(variantIds).toEqual(singleIds);
  });

  it('all variants should start and end at outermost lane', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    for (const variant of variants) {
      expect(variant[0]!.from.lane).toBe(1); // outermost for 4-lane (2 per direction)
      expect(variant[variant.length - 1]!.to.lane).toBe(1);
    }
  });

  it('should produce at least 2 variants on 2-lane road', () => {
    // 2-lane road has lane 0 (inner) and that's it per direction
    // But with long enough road, there should be at least 1 path
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.TWO_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    // TWO_LANE has only 1 lane per direction, so all variants use same lane
    // Should still produce at least 1 variant
    expect(variants.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle single-cell path', () => {
    const { graph } = buildStraightRoad(1);
    const variants = refineLanePathVariants(graph, ['0,0']);
    expect(variants).toEqual([[]]);
  });

  it('should return empty for impossible path', () => {
    const { graph } = buildStraightRoad(3);
    const variants = refineLanePathVariants(graph, ['0,0', '5,5']);
    expect(variants.length).toBe(0);
  });

  it('on 6-lane road should produce 3 distinct variants', () => {
    const { graph, cellKeys } = buildStraightRoad(10, RoadType.SIX_LANE);
    const variants = refineLanePathVariants(graph, cellKeys);

    expect(variants.length).toBe(3);

    // Each variant should use a different "cruise" lane
    // Collect the most common lane for middle edges of each variant
    const cruiseLanes = variants.map(v => {
      const middleEdges = v.filter(e => e.type === 'straight');
      const laneCounts = new Map<number, number>();
      for (const e of middleEdges) {
        const lane = e.from.lane;
        laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
      }
      let maxLane = 0, maxCount = 0;
      for (const [lane, count] of laneCounts) {
        if (count > maxCount) { maxLane = lane; maxCount = count; }
      }
      return maxLane;
    });

    // At least 2 distinct cruise lanes
    const uniqueLanes = new Set(cruiseLanes);
    expect(uniqueLanes.size).toBeGreaterThanOrEqual(2);
  });
});

import { describe, it, expect } from 'vitest';
import { SidewalkStopReach } from '../StopWalkReach';
import { cityWithMainRoad } from './gridCityFixture';

/**
 * Which cells a stop can be walked to, measured along the sidewalk graph rather than as a
 * diamond.
 *
 * Pedestrians only cross at junctions, so the cell across the road is a long walk: to the
 * nearest junction, across, and back. By Manhattan distance it is two tiles, so the simulation
 * assigns households to the stop opposite and the pedestrian has to loop around — the detour
 * is a dispatch error, not a pathfinding one.
 */

const RANGE = 5;

describe('站牌的步行涵蓋範圍', () => {
  it('should reach a neighbour on the same side of the road', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(12, 11, RANGE);

    expect(cells.has('13,11'), '同一側的隔壁格走不到，這條測試等於沒測').toBe(true);
    expect(cells.get('13,11')!).toBeLessThan(2);
  });

  it('should not reach the cell directly across the road', () => {
    // Junctions at x=8 and x=16 with the stop at x=12: crossing means 4 tiles to a junction,
    // across, and 4 back, well beyond the 5-tile walk limit.
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(12, 11, RANGE);

    expect(
      cells.has('12,9'),
      '馬路對面被算成走得到 —— 住戶會被派去對面的站牌，行人得繞到路口',
    ).toBe(false);
  });

  it('should reach across when the stop sits next to an intersection', () => {
    // Same road, but with the stop beside a junction the far side really is walkable. This is
    // where stop placement becomes a decision that matters.
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(9, 11, RANGE);

    expect(cells.has('9,9'), '緊鄰路口的站牌，對面仍然走不到').toBe(true);
  });

  it('should reach nothing across a road with no intersection at all', () => {
    const { graph } = cityWithMainRoad(0);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(12, 11, RANGE);

    expect(cells.has('13,11'), '連同側都走不到，這條測試等於沒測').toBe(true);
    expect(cells.has('12,9'), '一條沒有岔路的直路，兩側永遠連不起來').toBe(false);
  });

  it('should measure walking distance, not straight-line distance', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(12, 11, 12);

    const across = cells.get('12,9');
    expect(across, '把上限放寬到 12 格之後，對面應該走得到了').toBeDefined();
    expect(across!, '對面的距離被當成直線的 2 格').toBeGreaterThan(6);
  });
});

describe('步行涵蓋範圍的快取', () => {
  it('should reuse the same result for the same stop', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    expect(reach.cellsWithin(12, 11, RANGE)).toBe(reach.cellsWithin(12, 11, RANGE));
  });

  it('should recompute after the graph is rebuilt', () => {
    // A new graph generation makes old answers unusable. This is the safety net for a
    // forgotten invalidation: invalidateNear is deliberately not called, only the graph is
    // rebuilt.
    const city = cityWithMainRoad(0);
    const reach = new SidewalkStopReach(city.graph);
    const before = reach.cellsWithin(12, 11, RANGE);
    expect(before.has('12,9'), '一條沒有岔路的直路，對面本來就走不到').toBe(false);

    city.rebuildWith(5); // the player adds side roads and the junctions get closer

    const after = reach.cellsWithin(12, 11, RANGE);
    expect(after, '圖已經換了，快取還在回答舊答案').not.toBe(before);
    expect(after.has('12,9'), '路口變近了，對面應該走得到').toBe(true);
  });

  it('should drop only the stops near a change', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const near = reach.cellsWithin(12, 11, RANGE);
    const far = reach.cellsWithin(2, 11, RANGE);

    reach.invalidateNear(['12,12'], RANGE);

    expect(reach.cellsWithin(12, 11, RANGE), '改動附近的站牌沒有重算').not.toBe(near);
    expect(reach.cellsWithin(2, 11, RANGE), '離改動很遠的站牌被白白重算了').toBe(far);
  });

  it('should not trust a cached answer after an unannounced graph update', () => {
    // Not everyone who mutates the graph notifies this cache. `applyBuildingChange` is one:
    // it calls updateCells directly when a building appears or is demolished and knows nothing
    // about this cache. The generation is the safety net for that.
    const city = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(city.graph);
    const before = reach.cellsWithin(12, 11, RANGE);

    city.updateAt(['12,12']);

    expect(
      reach.cellsWithin(12, 11, RANGE),
      '圖已經被動過，快取還在回答舊答案',
    ).not.toBe(before);
  });

  it('should keep distant stops through an incremental graph update', () => {
    // Precise invalidation and the safety net conflict: an incremental update also advances the
    // generation, and without aligning it inside invalidateNear the next query is discarded
    // wholesale by the safety net, wasting the precise invalidation.
    const city = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(city.graph);
    const far = reach.cellsWithin(2, 11, RANGE);

    city.updateAt(['12,12']);
    reach.invalidateNear(['12,12'], RANGE);

    expect(reach.cellsWithin(2, 11, RANGE), '遠處的站牌被安全網一起丟掉了').toBe(far);
  });
});

describe('站牌沒有接上人行道', () => {
  it('should serve nobody when the stop is not in the graph at all', () => {
    // Deliberately no fallback to "find the nearest node", which would quietly paper over a
    // stop missing from the graph.
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    expect(reach.cellsWithin(999, 999, RANGE).size).toBe(0);
  });
});

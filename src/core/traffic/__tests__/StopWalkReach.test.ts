import { describe, it, expect } from 'vitest';
import { SidewalkStopReach } from '../StopWalkReach';
import { cityWithMainRoad } from './gridCityFixture';

/**
 * 站牌走得到哪些格子 —— 沿著人行道量，不是畫一個菱形。
 *
 * 行人只在路口過馬路，所以馬路對面的那一格在步行上其實很遠：得走到最近的路口、
 * 過去、再走回來。用曼哈頓距離量的話它只有兩格，於是模擬會把住戶配給對面的站牌，
 * 行人到了現場才發現得繞一大圈 —— 繞路不是走錯，是被派錯。
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
    // 路口在 x=8 與 x=16，站牌在 x=12 —— 過馬路要先走 4 格到路口，
    // 過去，再走 4 格回來，遠遠超過 5 格的步行上限。
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const cells = reach.cellsWithin(12, 11, RANGE);

    expect(
      cells.has('12,9'),
      '馬路對面被算成走得到 —— 住戶會被派去對面的站牌，行人得繞到路口',
    ).toBe(false);
  });

  it('should reach across when the stop sits next to an intersection', () => {
    // 同一條路，站牌改蓋在路口旁邊 —— 對面就真的走得到了。
    // 這是「站牌該蓋在哪」變成一個有意義的決定的地方。
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
    // 圖換了世代，舊答案就不能再用 —— 這是「忘了呼叫失效」時的安全網：
    // 這裡刻意不呼叫 invalidateNear，只把圖重建掉。
    const city = cityWithMainRoad(0);
    const reach = new SidewalkStopReach(city.graph);
    const before = reach.cellsWithin(12, 11, RANGE);
    expect(before.has('12,9'), '一條沒有岔路的直路，對面本來就走不到').toBe(false);

    city.rebuildWith(5); // 玩家補上一排岔路，路口變近了

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
    // 不是每個動圖的人都會通知這裡 —— `applyBuildingChange` 就是一個：建築長出來
    // 或被拆掉時它直接呼叫 updateCells，對這份快取一無所知。世代是這種情況的安全網。
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
    // 精準失效與安全網會打架：增量更新一樣會推進世代，若不在 invalidateNear
    // 裡把世代對齊，下一次查詢會被安全網整批丟掉，精準失效等於白做。
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
    // 刻意不退回「找最近的節點」：那會讓「站牌沒進圖」靜靜地被蓋掉，
    // 而站牌漏進圖正是這一輪要修的問題之一。
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    expect(reach.cellsWithin(999, 999, RANGE).size).toBe(0);
  });
});

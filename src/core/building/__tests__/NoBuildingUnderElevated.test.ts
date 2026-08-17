import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { canPlaceInfra } from '../InfraPlacement';
import { BuildingGrowth } from '../BuildingGrowth';
import { getZoneBlocker } from '../../zone/ZoneBlocker';

/**
 * 高架下方不能有房子。
 *
 * 實測:醫院蓋得進高架橋底下。`canPlaceInfra` 只看格子上的東西 —— 地形、道路、
 * 鐵軌、既有建築 —— 而高架路段不在格子上，它住在 `ElevationManager` 裡，所以每一
 * 條檢查都通過。
 *
 * 三個入口都要擋:玩家自己蓋的公共建築、建商長出來的房子、以及告訴玩家「這塊地為
 * 什麼不長東西」的那份診斷。少擋一個就等於沒擋。
 */

function gridWithRoad(): Grid {
  const grid = new Grid(20, 20);
  // 沿著 y=0 給一條路，這樣公共建築與分區都連得到路。
  for (let x = 0; x < 20; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
  return grid;
}

/** 高架橋壓在這幾格上。 */
const elevatedAt = (...cells: [number, number][]) =>
  (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);

describe('公共建築不能蓋在高架下', () => {
  it('should refuse a hospital under the viaduct', () => {
    const grid = gridWithRoad();
    const r = canPlaceInfra(grid, 2, 1, 'hospital', 0, undefined, undefined, elevatedAt([2, 1]));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('UNDER_ELEVATED_ROAD');
  });

  it('should refuse when the viaduct only clips one corner of the footprint', () => {
    // 醫院是 2×3。只有角落那一格在橋下也算 —— 房子不會為了橋讓出一角。
    const grid = gridWithRoad();
    const r = canPlaceInfra(grid, 2, 1, 'hospital', 0, undefined, undefined, elevatedAt([3, 3]));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('UNDER_ELEVATED_ROAD');
  });

  it('should still allow a hospital that clears the viaduct', () => {
    const grid = gridWithRoad();
    expect(canPlaceInfra(grid, 2, 1, 'hospital', 0, undefined, undefined, elevatedAt([9, 9])).ok)
      .toBe(true);
  });

  it('should behave exactly as before when nobody asks about elevation', () => {
    // 參數是選填的:`WaterPlantSites` 之類的呼叫端沒有 ElevationManager。
    const grid = gridWithRoad();
    expect(canPlaceInfra(grid, 2, 1, 'hospital', 0).ok).toBe(true);
  });
});

describe('建商不能在高架下蓋房子', () => {
  const conditions = {
    hasPower: true, hasWater: true,
    rciDemand: { residential: 90, commercial: 90, industrial: 90 },
  };

  it('should not grow a house under the viaduct', () => {
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    const growth = new BuildingGrowth(grid);
    expect(growth.canGrow(3, 1, { ...conditions, underElevated: true })).toBe(false);
  });

  it('should still grow one that is in the open', () => {
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    const growth = new BuildingGrowth(grid);
    expect(growth.canGrow(3, 1, { ...conditions, underElevated: false })).toBe(true);
  });

  it('should treat a caller that never mentions elevation as open sky', () => {
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    expect(new BuildingGrowth(grid).canGrow(3, 1, conditions)).toBe(true);
  });
});

describe('空地不長東西的時候要說是因為高架', () => {
  const deps = {
    isPowered: () => true,
    isWatered: () => true,
    rciDemand: { residential: 90, commercial: 90, industrial: 90 },
  };

  it('should name the viaduct', () => {
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    expect(getZoneBlocker(grid, 3, 1, { ...deps, hasElevatedAbove: elevatedAt([3, 1]) }))
      .toBe('UNDER_ELEVATED_ROAD');
  });

  it('should say nothing is wrong when the sky is clear', () => {
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    expect(getZoneBlocker(grid, 3, 1, { ...deps, hasElevatedAbove: elevatedAt([9, 9]) }))
      .toBeNull();
  });

  it('should mirror canGrow — whatever growth refuses, this explains', () => {
    // ZoneBlocker 的存在理由就是「跟 canGrow 問同一組條件」。兩邊漂開的話，玩家
    // 會看到一塊寫著「沒問題」卻永遠不長東西的地。
    const grid = gridWithRoad();
    grid.setCell(3, 1, { zoneType: ZoneType.RESIDENTIAL_LOW });
    const growth = new BuildingGrowth(grid);
    const under = elevatedAt([3, 1]);
    const conditions = {
      hasPower: true, hasWater: true,
      rciDemand: deps.rciDemand,
      underElevated: under(3, 1),
    };
    expect(growth.canGrow(3, 1, conditions)).toBe(false);
    expect(getZoneBlocker(grid, 3, 1, { ...deps, hasElevatedAbove: under })).not.toBeNull();
  });
});

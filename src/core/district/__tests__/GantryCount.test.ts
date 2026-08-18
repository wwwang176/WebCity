import { describe, it, expect } from 'vitest';
import { countRoadCellsInDistrict } from '../DistrictManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { createGameState } from '../../simulation/GameState';
import { scaleOf } from '../../__tests__/helpers/policyScale';

/**
 * 門架是架在路上的，不是架在地上。
 *
 * 用分區的總格數計價的話，圈一片公園綠地跟圈一片密集路網要付一樣多的維運費 ——
 * 而前者根本沒有地方可以架門架。
 */

function city() {
  const state = createGameState(30, 30);
  // 一條東西向的路穿過中間。
  for (let x = 0; x < 30; x++) state.grid.setCell(x, 10, { roadType: RoadType.TWO_LANE });
  // 其餘是綠地（沒有道路）。
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  return state;
}

describe('門架數', () => {
  it('should count the road cells, not the land', () => {
    const state = city();
    const d = state.districts.createDistrict('D');
    // 圈一塊 6 格寬、3 列高的地:18 格，其中只有 6 格是路。
    for (let x = 2; x < 8; x++) {
      for (let y = 10; y <= 12; y++) state.districts.addCellToDistrict(d.id, x, y);
    }
    expect(d.cells.size, '分區沒有 18 格，這條測試在量別的東西').toBe(18);
    expect(countRoadCellsInDistrict(state.grid, d), '算到的不是道路格數').toBe(6);
  });

  it('should count nothing in a district with no road at all', () => {
    const state = city();
    const d = state.districts.createDistrict('Park');
    for (let x = 2; x < 20; x++) state.districts.addCellToDistrict(d.id, x, 12);
    expect(d.cells.size, '分區是空的，這條測試等於空轉').toBeGreaterThan(0);
    expect(countRoadCellsInDistrict(state.grid, d), '一條路都沒有卻算出門架').toBe(0);
  });

  it('should ignore cells outside the map', () => {
    // 存檔是可以編輯的。越界的格子查不到 cell，不能當成有路。
    const state = city();
    const d = state.districts.createDistrict('D');
    d.cells.add('999,999');
    d.cells.add('-3,4');
    expect(countRoadCellsInDistrict(state.grid, d), '越界的格子被算成道路').toBe(0);
  });
});

describe('壅塞費的門架維運費', () => {
  it('should follow the roads inside the cordon', () => {
    const sparse = scaleOf({ districtCells: 400, districtRoadCells: 4 });
    const dense = scaleOf({ districtCells: 400, districtRoadCells: 60 });
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, sparse), '門架完全不用錢')
      .toBeGreaterThan(0);
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, dense), '路網密的收費區沒有比較貴')
      .toBeGreaterThan(policyCost(PolicyType.CONGESTION_CHARGE, 1, sparse));
  });

  it('should cost nothing to run a cordon with no roads in it', () => {
    // 圈一片荒地不該產生任何門架維運費 —— 那裡一台車都開不進來。
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 2, scaleOf({ districtCells: 900 })),
      '荒地上的收費區還在收門架維運費').toBe(0);
  });

  it('should not follow the total area', () => {
    const small = scaleOf({ districtCells: 20, districtRoadCells: 10 });
    const big = scaleOf({ districtCells: 900, districtRoadCells: 10 });
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, big), '門架費跟著圈地的大小走')
      .toBe(policyCost(PolicyType.CONGESTION_CHARGE, 1, small));
  });
});

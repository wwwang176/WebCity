import { describe, it, expect } from 'vitest';
import { countRoadCellsInDistrict } from '../DistrictManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { createGameState } from '../../simulation/GameState';
import { scaleOf } from '../../__tests__/helpers/policyScale';

/**
 * Gantries stand on roads, not on land.
 *
 * Priced by total district cells, enclosing a park costs the same upkeep as enclosing a dense
 * road network, and the park has nowhere to put a gantry.
 */

function city() {
  const state = createGameState(30, 30);
  // One east-west road across the middle.
  for (let x = 0; x < 30; x++) state.grid.setCell(x, 10, { roadType: RoadType.TWO_LANE });
  // The rest is green field with no roads.
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  return state;
}

describe('門架數', () => {
  it('should count the road cells, not the land', () => {
    const state = city();
    const d = state.districts.createDistrict('D');
    // A plot 6 cells wide and 3 rows tall: 18 cells, of which only 6 are road.
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
    // Saves are editable. An out-of-bounds cell has no record and cannot count as road.
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
    // Enclosing open country should produce no gantry upkeep: not one car can drive in.
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

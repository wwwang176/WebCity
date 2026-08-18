import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { buildEconomyBreakdownContext } from '../../economy/EconomyBreakdownContext';
import { computeCityScales } from '../../district/PolicyBilling';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

/**
 * 條例存起來不等於模擬會讀。這幾條走真的路徑。
 *
 * 建築直接種進格子、人口直接造:
 *
 * - `PowerGrid.calculateDemand` 只算 `buildingId > 0` 的格子，而建築成長要求該格
 *   有電有水 —— 沒有電廠水廠的測試城市長不出任何東西，需求會是 0，正向控制就先掛了。
 * - `getPopulation()` 是市民陣列的長度，新遊戲是 0，而節能法規按人口計費，人口 0
 *   時費用恆為 0。
 */

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;

function city(): { state: GameState; loop: SimulationLoop } {
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
  return { state, loop: new SimulationLoop(state) };
}

/** `EconomyBreakdownContext.policyCost` 宣告成可選，面板自己也是當 0 處理。 */
const policyExpense = (state: GameState) =>
  buildEconomyBreakdownContext(state, null, 0).policyCost ?? 0;

describe('全城條例真的接進模擬', () => {
  it('should lower total power demand', () => {
    const demandOf = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, level);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.power.getDemand();
    };
    const plain = demandOf(0);
    expect(plain, '沒有電力需求可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(demandOf(3), '節能法規沒有降低電力需求').toBeLessThan(plain);
  });

  it('should show up as an expense in the budget', () => {
    const { state } = city();
    expect(state.citizens.getPopulation(), '沒有人口，按人口計費的條例會恆為 0')
      .toBeGreaterThan(0);
    const plain = policyExpense(state);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const withOrdinance = policyExpense(state);
    expect(withOrdinance, '全城條例沒有進預算').toBeGreaterThan(plain);
    expect(withOrdinance - plain, '進預算的金額跟條例自己算的對不起來')
      .toBeCloseTo(state.ordinances.totalCost(
        computeCityScales(state.citizens.getCitizens(), () => false)), 6);
  });

  it('should cost commercial and industrial revenue', () => {
    // 節能法規的代價落在業者身上:設備更新與製程改造。住宅不受影響。
    const { state } = city();
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有被扣')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業沒有被扣')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
    // 工業扣得比商業重 —— 製程改造比換一批冷氣貴得多。只驗「兩個都 < 1」的話，
    // 把工業誤套成商業的倍率也會過。
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業與商業被扣得一樣多')
      .toBeLessThan(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW));
  });

  it('should apply outside any district too', () => {
    // 全城條例對每一格都生效，包含不屬於任何分區的格子 —— 那正是它「全城」的意思。
    const { state } = city();
    const deps = buildEconomyBreakdownContext(state, null, 0);
    const outsideAnyDistrict = deps.getRevenueMultiplier!(7, 11, ZoneType.COMMERCIAL_LOW);
    expect(state.districts.getDistrictAt(7, 11), '這一格屬於某個分區，測不到要測的東西')
      .toBeNull();
    expect(outsideAnyDistrict, '沒開條例就已經不是 1').toBe(1);

    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const after = buildEconomyBreakdownContext(state, null, 0)
      .getRevenueMultiplier!(7, 11, ZoneType.COMMERCIAL_LOW);
    expect(after, '分區外的格子沒有吃到全城條例').toBeLessThan(1);
  });
});

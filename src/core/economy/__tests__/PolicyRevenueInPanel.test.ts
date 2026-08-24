import { describe, it, expect } from 'vitest';
import { getEconomyBreakdown, panelIncomeTotal } from '../EconomyBreakdown';
import { buildEconomyBreakdownContext } from '../EconomyBreakdownContext';
import { listPolicyExpenses } from '../ExpenseCalculator';
import { computeCityScales } from '../../district/PolicyBilling';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * Income on the ledger must match what the treasury actually takes in.
 *
 * `EconomyPanelMatchesBudget` guards only the expense half. Ordinances that earn money can
 * drift on the income half: the treasury adds a toll the panel does not, and the balance the
 * player reads is wrong.
 */

function chargedCity(): { state: GameState; loop: SimulationLoop } {
  reseedRandom();
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(16, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  state.bus.createRoute(
    [state.bus.addStop(7, 1), state.bus.addStop(15, 1), state.bus.addStop(57, 1)], 1);
  for (let k = 0; k < 20; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '16,2' });
  }
  const d = state.districts.createDistrict('Downtown');
  for (let x = 12; x <= 20; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
  }
  state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop };
}

useSeededRandom();

describe('條例的收入也要上帳本', () => {
  it('should show the toll as income, not as a negative expense', () => {
    const { state, loop } = chargedCity();
    const b = getEconomyBreakdown(
      buildEconomyBreakdownContext(state, null, loop.billableDistricts()));
    expect(b.policyRevenue, '帳本上看不到過路費').toBeGreaterThan(0);
    expect(b.policyCost, '門架的維運費不見了 —— 收入不該把支出吃掉').toBeGreaterThan(0);
  });

  it('should report the same income the treasury credits', () => {
    const { state, loop } = chargedCity();
    const b = getEconomyBreakdown(
      buildEconomyBreakdownContext(state, null, loop.billableDistricts()));
    expect(state.budget.income, '市庫沒有收入，這條測試等於空轉').toBeGreaterThan(0);
    // The panel total lives in an extracted function; written inline in the .tsx, a missing
    // term would turn no test red.
    expect(panelIncomeTotal(b), '面板的總收入跟市庫入帳的對不起來')
      .toBeCloseTo(state.budget.income, 0);
  });

  it('should keep the toll out of the income when nobody is charged', () => {
    const { state } = chargedCity();
    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, null, []));
    expect(b.policyRevenue, '沒有人付過路費卻還是有收入').toBe(0);
  });

  it('should list both sides of the same policy', () => {
    // Congestion charging has both sides. Netted into one figure, the player cannot tell
    // whether a swing from profit to loss came from fewer cars or from a larger charging zone.
    const { state, loop } = chargedCity();
    const scale = computeCityScales(
      state.citizens.getCitizens(), (x, y) => state.health.getCoverage(x, y));
    const lines = listPolicyExpenses(loop.billableDistricts(), state.ordinances, scale);
    const toll = lines.find(l => l.type === PolicyType.CONGESTION_CHARGE);
    expect(toll, '帳本上沒有壅塞費這一列').toBeDefined();
    expect(toll!.cost, '門架的維運費沒有列出來').toBeGreaterThan(0);
    expect(toll!.revenue, '過路費沒有列出來').toBeGreaterThan(0);
  });

  it('should still list a policy that only costs money', () => {
    const { state, loop } = chargedCity();
    state.ordinances.setLevel(PolicyType.SMOKING_BAN, 1);
    const scale = computeCityScales(
      state.citizens.getCitizens(), (x, y) => state.health.getCoverage(x, y));
    const ban = listPolicyExpenses(loop.billableDistricts(), state.ordinances, scale)
      .find(l => l.type === PolicyType.SMOKING_BAN);
    expect(ban, '只花錢的條例從帳本上消失了').toBeDefined();
    expect(ban!.revenue, '禁菸令憑空生出收入').toBe(0);
  });
});

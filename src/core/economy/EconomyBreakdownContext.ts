/**
 * Assemble the economy-breakdown context from GameState.
 *
 * This used to live inline in Game.ts, which imports Three.js and is therefore
 * untestable — and that is precisely why the panel could disagree with what
 * SimulationLoop actually charges (BUG-062, and the power/water double-count it
 * left behind). Extracted here so the "panel total === budget.expenses"
 * invariant can be asserted in a test.
 */
import type { GameState } from '../simulation/GameState';
import type { ElevationManager } from '../elevation/ElevationManager';
import type { EconomyBreakdownContext } from './EconomyBreakdown';
import { buildIncomeCalcDeps } from './IncomeCalcAdapter';
import { countRoadTiles } from '../grid/GridHelpers';
import { getUtilityMaintenanceCost, getCivicMaintenanceCostExcludingUtilities } from '../service/ServiceRegistry';
import { getTotalTransportOperatingCost } from '../transport/TransportRegistry';
import { totalPolicyExpense, totalPolicyRevenue } from './ExpenseCalculator';
import { computeCityScales } from '../district/PolicyBilling';
import { billableDistricts } from '../district/DistrictManager';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';

export function buildEconomyBreakdownContext(
  state: GameState,
  elevationManager: ElevationManager | null,
  /**
   * 付了壅塞費的通勤人數。
   *
   * 必填而不是給預設 0 —— 它算不出來自 GameState（要知道每個人選了哪一種交通
   * 方式，那是通勤統計那一趟的產物），而漏填的話面板會少報一筆收入，跟市庫
   * 實際入帳的對不起來。
   */
  chargedDrivers: number,
): EconomyBreakdownContext {
  const utilities = getUtilityMaintenanceCost(state);
  const scales = {
    ...computeCityScales(state.citizens.getCitizens(), (x, y) => state.health.getCoverage(x, y)),
    chargedDrivers,
  };
  return {
    ...buildIncomeCalcDeps(state),
    roadTileCount: countRoadTiles(state.grid),
    loans: state.budget.loans,
    loanInterestRate: state.budget.loanInterestRate,
    powerMaintenanceCost: utilities.power,
    waterMaintenanceCost: utilities.water,
    transportOperatingCost: getTotalTransportOperatingCost(state),
    // Power and water are itemised as their own rows above, so this must be the
    // civic total MINUS them. Passing the full total double-charged the panel.
    serviceCost: getCivicMaintenanceCostExcludingUtilities(state),
    policyCost: totalPolicyExpense(
      billableDistricts(state.grid, state.districts.getAllDistricts()),
      state.ordinances, scales,
    ),
    policyRevenue: totalPolicyRevenue(
      billableDistricts(state.grid, state.districts.getAllDistricts()),
      state.ordinances, scales,
    ),
    elevatedMaintenance: elevationManager ? calculateElevatedMaintenance(elevationManager) : 0,
    revenueMultiplier: state.citySpec.getBonus().revenueMultiplier,
  };
}

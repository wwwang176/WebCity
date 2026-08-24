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
import type { PolicyType } from '../district/types';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';

export function buildEconomyBreakdownContext(
  state: GameState,
  elevationManager: ElevationManager | null,
  /**
   * The districts' billing data: road cell counts and paying drivers.
   *
   * Required rather than derived from `state`, because the paying-driver count cannot be computed
   * from GameState: it needs each citizen's chosen mode of travel, which is a product of the
   * commute statistics pass. Omitted, the panel under-reports income and disagrees with what the
   * treasury actually receives.
   */
  districts: readonly {
    name: string;
    cells: { size: number };
    roadCells: number;
    chargedDrivers: number;
    policies: readonly { type: PolicyType; level: number }[];
  }[],
): EconomyBreakdownContext {
  const utilities = getUtilityMaintenanceCost(state);
  const scales = computeCityScales(
    state.citizens.getCitizens(), (x, y) => state.health.getCoverage(x, y));
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
    policyCost: totalPolicyExpense(districts, state.ordinances, scales),
    policyRevenue: totalPolicyRevenue(districts, state.ordinances, scales),
    elevatedMaintenance: elevationManager ? calculateElevatedMaintenance(elevationManager) : 0,
    revenueMultiplier: state.citySpec.getBonus().revenueMultiplier,
  };
}

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
import { totalPolicyExpense } from './ExpenseCalculator';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';

export function buildEconomyBreakdownContext(
  state: GameState,
  elevationManager: ElevationManager | null,
): EconomyBreakdownContext {
  const utilities = getUtilityMaintenanceCost(state);
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
      state.districts.getAllDistricts(),
      state.ordinances,
      state.citizens.getPopulation(),
    ),
    elevatedMaintenance: elevationManager ? calculateElevatedMaintenance(elevationManager) : 0,
    revenueMultiplier: state.citySpec.getBonus().revenueMultiplier,
  };
}

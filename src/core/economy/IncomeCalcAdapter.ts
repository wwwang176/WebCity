import type { GameState } from '../simulation/GameState';
import type { IncomeCalcDeps } from './IncomeCalculator';
import { getSpecializationBonus } from '../district/Specialization';

/**
 * Build IncomeCalcDeps from GameState (DRY).
 * Both SimulationLoop.calculateIncome and Game.getEconomyBreakdown
 * need the same adapter — extracted here to eliminate duplication.
 */
export function buildIncomeCalcDeps(
  state: GameState,
  getAbandonmentStress?: (x: number, y: number) => number,
): IncomeCalcDeps {
  return {
    forEachCell: (fn) => state.grid.forEachCell(fn),
    taxRates: state.taxRates,
    getCitizensByHome: (key) => state.citizens.getCitizensByHome(key),
    getRevenueMultiplier: (x, y) => {
      const district = state.districts.getDistrictAt(x, y);
      return district ? getSpecializationBonus(district.specialization).revenueMultiplier : 1;
    },
    isPowered: (x, y) => state.power.isPowered(x, y),
    getAbandonmentStress,
  };
}

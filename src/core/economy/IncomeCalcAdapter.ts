import type { GameState } from '../simulation/GameState';
import type { IncomeCalcDeps } from './IncomeCalculator';
import { getSpecializationBonus } from '../district/Specialization';

/**
 * Build IncomeCalcDeps from GameState (DRY).
 * Both SimulationLoop.calculateIncome and Game.getEconomyBreakdown
 * need the same adapter — extracted here to eliminate duplication.
 */
export function buildIncomeCalcDeps(state: GameState): IncomeCalcDeps {
  return {
    forEachCell: (fn) => state.grid.forEachCell(fn),
    taxRates: state.taxRates,
    getResidentEducations: (key) => state.citizens.getCitizensByHome(key).map(c => c.education),
    getRevenueMultiplier: (x, y) => {
      const district = state.districts.getDistrictAt(x, y);
      return district ? getSpecializationBonus(district.specialization).revenueMultiplier : 1;
    },
    isPowered: (x, y) => state.power.isPowered(x, y),
    getFreightSupply: (x, y) => state.freight.getSupplyStatus(x, y),
    freightSurplusRatio: state.freight.getSurplusRatio(),
    isExporting: state.freight.getIsExporting(),
  };
}

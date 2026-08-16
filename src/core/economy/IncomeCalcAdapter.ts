import type { GameState } from '../simulation/GameState';
import type { IncomeCalcDeps } from './IncomeCalculator';
import { getSpecializationBonus } from '../district/Specialization';
import type { EducationLevel } from '../citizen/types';

/** Shared empty result — the deps are read-only, so one instance is safe. */
const EMPTY_EDUCATIONS: EducationLevel[] = [];

/**
 * Build IncomeCalcDeps from GameState (DRY).
 * Both SimulationLoop.calculateIncome and Game.getEconomyBreakdown
 * need the same adapter — extracted here to eliminate duplication.
 */
export function buildIncomeCalcDeps(state: GameState): IncomeCalcDeps {
  // Index residents and workers by position in ONE pass.
  //
  // getCitizensByHome / getCitizensByWorkplace are bare Array.filter scans that
  // allocate a fresh array per call, and calculateZoneIncomes calls one of them
  // once per zone building — O(buildings x citizens) on the main thread, every
  // income tick and again on every throttled UI refresh while the Economy page
  // is open (measured: 265 ms for 30k citizens / 2k buildings, i.e. a visible
  // frame hitch). ServiceRegistry.tickAllCivicServices already uses exactly this
  // idiom; calculateZoneIncomes was the lone outlier (BUG-066).
  const educationsByHome = new Map<string, EducationLevel[]>();
  const workerCountByPos = new Map<string, number>();
  for (const c of state.citizens.getCitizens()) {
    if (c.homeId) {
      const list = educationsByHome.get(c.homeId);
      if (list) list.push(c.education);
      else educationsByHome.set(c.homeId, [c.education]);
    }
    if (c.workplaceId) {
      workerCountByPos.set(c.workplaceId, (workerCountByPos.get(c.workplaceId) ?? 0) + 1);
    }
  }

  return {
    forEachCell: (fn) => state.grid.forEachCell(fn),
    taxRates: state.taxRates,
    getResidentEducations: (key) => educationsByHome.get(key) ?? EMPTY_EDUCATIONS,
    getRevenueMultiplier: (x, y, zoneType) => {
      // 全城條例對每一格都生效，包含不屬於任何分區的格子 —— 那正是它「全城」的
      // 意思，所以要在提早 return 之前乘。
      const cityWide = state.ordinances.getRevenueMultiplier(zoneType);
      const district = state.districts.getDistrictAt(x, y);
      if (!district) return cityWide;
      // Specialization and policy compose: a tourist district that also
      // specialises in tourism gets both, which is the point of paying twice.
      return cityWide
        * getSpecializationBonus(district.specialization).revenueMultiplier
        * state.policies.getRevenueMultiplier(district.id, zoneType);
    },
    isPowered: (x, y) => state.power.isPowered(x, y),
    getFreightSupply: (x, y) => state.freight.getSupplyStatus(x, y),
    freightSurplusRatio: state.freight.getSurplusRatio(),
    isExporting: state.freight.getIsExporting(),
    getWorkerCount: (key) => workerCountByPos.get(key) ?? 0,
  };
}

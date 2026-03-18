import { isZoneBuilding } from '../building/InfraConfig';
import { getBuildingType } from '../building/types';
import { isResidentialZone, isCommercialZone, ZoneType } from '../grid/types';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { getBuildingLevelMultiplier, ECONOMY } from './TaxMultipliers';

export interface ZoneIncomeBreakdown {
  residential: number;
  commercial: number;
  industrial: number;
  office: number;
}

/** Minimal cell shape needed for income calculation. */
interface CellLike {
  buildingId: number;
  zoneType: number;
  reserved: number;
}

/**
 * Dependencies for income calculation (DIP).
 * Both SimulationLoop and Game.ts provide these.
 */
export interface IncomeCalcDeps {
  forEachCell: (fn: (cell: CellLike, x: number, y: number) => void) => void;
  taxRates: { residential: number; business: number };
  getResidentCount: (posKey: string) => number;
  /** Optional per-building revenue multiplier (e.g. district specialization). */
  getRevenueMultiplier?: (x: number, y: number) => number;
  /** Optional power check — unpowered buildings produce zero income. Defaults to true. */
  isPowered?: (x: number, y: number) => boolean;
}

/**
 * Calculate per-zone-type income breakdown from grid state.
 * Pure function — no side effects, no dependencies on specific classes.
 */
export function calculateZoneIncomes(deps: IncomeCalcDeps): ZoneIncomeBreakdown {
  const incomeTaxRate = deps.taxRates.residential ?? 9;
  const businessTaxRate = deps.taxRates.business ?? 9;

  let residential = 0;
  let commercial = 0;
  let industrial = 0;
  let office = 0;

  deps.forEachCell((cell, x, y) => {
    if (!isZoneBuilding(cell.buildingId) || cell.reserved === BURNED || cell.reserved === ABANDONED || cell.reserved === MULTI_CELL_OCCUPIED) return;
    // Unpowered buildings produce zero income
    if (deps.isPowered && !deps.isPowered(x, y)) return;

    const btype = getBuildingType(cell.buildingId);
    if (!btype) return;

    let buildingIncome = 0;
    if (isResidentialZone(btype.zoneType)) {
      const posKey = `${x},${y}`;
      const residentCount = deps.getResidentCount(posKey);
      buildingIncome = residentCount * ECONOMY.CITIZEN_BASE_INCOME * getBuildingLevelMultiplier(btype.level as 1 | 2 | 3) * (incomeTaxRate / 100);
      // Apply per-building revenue multiplier (e.g. district specialization)
      if (deps.getRevenueMultiplier) buildingIncome *= deps.getRevenueMultiplier(x, y);
      residential += buildingIncome;
    } else {
      const ci = btype.companyIncome ?? 0;
      buildingIncome = ci * getBuildingLevelMultiplier(btype.level) * (businessTaxRate / 100);
      if (deps.getRevenueMultiplier) buildingIncome *= deps.getRevenueMultiplier(x, y);
      if (isCommercialZone(btype.zoneType)) {
        commercial += buildingIncome;
      } else if (btype.zoneType === ZoneType.INDUSTRIAL) {
        industrial += buildingIncome;
      } else if (btype.zoneType === ZoneType.OFFICE) {
        office += buildingIncome;
      }
    }
  });

  return { residential, commercial, industrial, office };
}

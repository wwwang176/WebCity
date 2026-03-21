import { isZoneBuilding } from '../building/InfraConfig';
import { getBuildingType } from '../building/types';
import { isResidentialZone, isCommercialZone, ZoneType } from '../grid/types';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { getBuildingLevelMultiplier, getResidentialLevelMultiplier, getEducationSalaryMultiplier, ECONOMY } from './TaxMultipliers';
import type { EducationLevel } from '../citizen/types';

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
  getResidentEducations: (posKey: string) => Iterable<EducationLevel>;
  /** Optional per-building revenue multiplier (e.g. district specialization). */
  getRevenueMultiplier?: (x: number, y: number) => number;
  /** Optional power check — unpowered buildings produce zero income. Defaults to true. */
  isPowered?: (x: number, y: number) => boolean;
  /** Optional freight supply check — unsupplied commercial buildings earn half income. */
  isFreightSupplied?: (x: number, y: number) => boolean;
  /** Optional freight surplus ratio (0~1) — industrial income reduced proportionally. */
  freightSurplusRatio?: number;
}

/**
 * Calculate per-zone-type income breakdown from grid state.
 * Pure function — no side effects, no dependencies on specific classes.
 *
 * Residential tax = Σ(per resident: base × eduMultiplier) × buildingLevelMultiplier × taxRate
 * Business tax = companyIncome × buildingLevelMultiplier × taxRate
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
      // Sum per-resident education-based salary
      let residentSalarySum = 0;
      for (const edu of deps.getResidentEducations(posKey)) {
        residentSalarySum += ECONOMY.CITIZEN_BASE_INCOME * getEducationSalaryMultiplier(edu);
      }
      buildingIncome = residentSalarySum * getResidentialLevelMultiplier(btype.level as 1 | 2 | 3) * (incomeTaxRate / 100);
      // Apply per-building revenue multiplier (e.g. district specialization)
      if (deps.getRevenueMultiplier) buildingIncome *= deps.getRevenueMultiplier(x, y);
      residential += buildingIncome;
    } else {
      const ci = btype.companyIncome ?? 0;
      buildingIncome = ci * getBuildingLevelMultiplier(btype.level) * (businessTaxRate / 100);
      if (deps.getRevenueMultiplier) buildingIncome *= deps.getRevenueMultiplier(x, y);
      if (isCommercialZone(btype.zoneType)) {
        // Unsupplied commercial buildings earn half income
        if (deps.isFreightSupplied && !deps.isFreightSupplied(x, y)) {
          buildingIncome *= 0.5;
        }
        commercial += buildingIncome;
      } else if (btype.zoneType === ZoneType.INDUSTRIAL) {
        // Surplus reduces industrial income
        if (deps.freightSurplusRatio != null && deps.freightSurplusRatio > 0) {
          buildingIncome *= 1 - deps.freightSurplusRatio * 0.5;
        }
        industrial += buildingIncome;
      } else if (btype.zoneType === ZoneType.OFFICE) {
        office += buildingIncome;
      }
    }
  });

  return { residential, commercial, industrial, office };
}

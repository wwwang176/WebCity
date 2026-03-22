import { isZoneBuilding } from '../building/InfraConfig';
import { getBuildingType } from '../building/types';
import { isResidentialZone, isCommercialZone, ZoneType } from '../grid/types';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { getBuildingLevelMultiplier, getResidentialLevelMultiplier, getEducationSalaryMultiplier, ECONOMY } from './TaxMultipliers';
import { TRADE } from '../traffic/FreightSystem';
import { DEFAULT_TAX_RATE } from './Tax';

const TRADE_IMPORT_MULTIPLIER = TRADE.IMPORT_INCOME_MULTIPLIER;
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
  /** Optional freight supply status with ratio. */
  getFreightSupply?: (x: number, y: number) => { source: string; ratio: number };
  /** Optional freight surplus ratio (0~1) — industrial income reduced proportionally. */
  freightSurplusRatio?: number;
  /** Whether industrial surplus is being exported (reduces surplus income penalty). */
  isExporting?: boolean;
}

/**
 * Calculate per-zone-type income breakdown from grid state.
 * Pure function — no side effects, no dependencies on specific classes.
 *
 * Residential tax = Σ(per resident: base × eduMultiplier) × buildingLevelMultiplier × taxRate
 * Business tax = companyIncome × buildingLevelMultiplier × taxRate
 */
export function calculateZoneIncomes(deps: IncomeCalcDeps): ZoneIncomeBreakdown {
  const incomeTaxRate = deps.taxRates.residential ?? DEFAULT_TAX_RATE;
  const businessTaxRate = deps.taxRates.business ?? DEFAULT_TAX_RATE;

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
        // Freight supply ratio affects commercial income
        if (deps.getFreightSupply) {
          const supply = deps.getFreightSupply(x, y);
          if (supply.source === 'imported') {
            buildingIncome *= TRADE_IMPORT_MULTIPLIER * supply.ratio + 0.5 * (1 - supply.ratio);
          } else if (supply.source === 'none') {
            buildingIncome *= 0.5;
          } else {
            // local: scale between full income and 0.5 based on ratio
            buildingIncome *= 0.5 + 0.5 * supply.ratio;
          }
        }
        commercial += buildingIncome;
      } else if (btype.zoneType === ZoneType.INDUSTRIAL) {
        // Surplus reduces industrial income; export softens the penalty
        if (deps.freightSurplusRatio != null && deps.freightSurplusRatio > 0) {
          const penalty = deps.isExporting ? 0.5 : 1.0;
          buildingIncome *= 1 - deps.freightSurplusRatio * penalty;
        }
        industrial += buildingIncome;
      } else if (btype.zoneType === ZoneType.OFFICE) {
        office += buildingIncome;
      }
    }
  });

  return { residential, commercial, industrial, office };
}

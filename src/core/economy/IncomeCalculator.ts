import { isZoneBuilding } from '../building/InfraConfig';
import { getBuildingType } from '../building/types';
import { isResidentialZone, isCommercialZone, ZoneType } from '../grid/types';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { getBuildingLevelMultiplier, getResidentialLevelMultiplier, getEducationSalaryMultiplier, ECONOMY } from './TaxMultipliers';
import { TRADE } from '../traffic/FreightSystem';
import { DEFAULT_TAX_RATE } from './Tax';

const TRADE_IMPORT_MULTIPLIER = TRADE.IMPORT_INCOME_MULTIPLIER;
import type { EducationLevel } from '../citizen/types';

/** Freight supply impact on commercial/industrial income */
export const FREIGHT_INCOME = {
  /** Minimum income ratio when no freight supply */
  NO_SUPPLY_RATIO: 0.5,
  /** Surplus export penalty softening factor */
  EXPORT_PENALTY: 0.5,
} as const;

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
 * Per-building income calculation dependencies (DIP).
 * Shared between calculateBuildingIncome, calculateSingleBuildingIncome,
 * and calculateZoneIncomes to eliminate duplication.
 */
export interface BuildingIncomeDeps {
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
  /** Optional worker count per building — business income scales with worker ratio. */
  getWorkerCount?: (posKey: string) => number;
}

/**
 * Dependencies for income calculation (DIP).
 * Both SimulationLoop and Game.ts provide these.
 */
export interface IncomeCalcDeps extends BuildingIncomeDeps {
  forEachCell: (fn: (cell: CellLike, x: number, y: number) => void) => void;
}

/**
 * Calculate income for a single building given its buildingId and position.
 * Shared core logic — eliminates duplication between
 * calculateSingleBuildingIncome and calculateZoneIncomes (DRY).
 */
export function calculateBuildingIncome(
  deps: BuildingIncomeDeps,
  x: number, y: number, buildingId: number,
): number {
  if (deps.isPowered && !deps.isPowered(x, y)) return 0;
  const btype = getBuildingType(buildingId);
  if (!btype) return 0;

  const posKey = `${x},${y}`;

  if (isResidentialZone(btype.zoneType)) {
    let salarySum = 0;
    for (const edu of deps.getResidentEducations(posKey)) {
      salarySum += ECONOMY.CITIZEN_BASE_INCOME * getEducationSalaryMultiplier(edu);
    }
    let income = salarySum * getResidentialLevelMultiplier(btype.level as 1 | 2 | 3) * ((deps.taxRates.residential ?? DEFAULT_TAX_RATE) / 100);
    if (deps.getRevenueMultiplier) income *= deps.getRevenueMultiplier(x, y);
    return income;
  }

  let income = (btype.companyIncome ?? 0) * getBuildingLevelMultiplier(btype.level) * ((deps.taxRates.business ?? DEFAULT_TAX_RATE) / 100);
  if (deps.getRevenueMultiplier) income *= deps.getRevenueMultiplier(x, y);
  if (deps.getWorkerCount && btype.workers > 0) {
    income *= Math.min(1, deps.getWorkerCount(posKey) / btype.workers);
  }
  if (isCommercialZone(btype.zoneType) && deps.getFreightSupply) {
    const supply = deps.getFreightSupply(x, y);
    if (supply.source === 'imported') {
      income *= TRADE_IMPORT_MULTIPLIER * supply.ratio + FREIGHT_INCOME.NO_SUPPLY_RATIO * (1 - supply.ratio);
    } else if (supply.source === 'none') {
      income *= FREIGHT_INCOME.NO_SUPPLY_RATIO;
    } else {
      income *= FREIGHT_INCOME.NO_SUPPLY_RATIO + FREIGHT_INCOME.NO_SUPPLY_RATIO * supply.ratio;
    }
  } else if (btype.zoneType === ZoneType.INDUSTRIAL && deps.freightSurplusRatio != null && deps.freightSurplusRatio > 0) {
    const penalty = deps.isExporting ? FREIGHT_INCOME.EXPORT_PENALTY : 1.0;
    income *= 1 - deps.freightSurplusRatio * penalty;
  }
  return income;
}

/**
 * Calculate actual tax income for a single building.
 * Used by the building info panel to display accurate per-building income.
 * Delegates to calculateBuildingIncome (DRY).
 */
export function calculateSingleBuildingIncome(
  deps: BuildingIncomeDeps,
  x: number, y: number, buildingId: number,
): number {
  return calculateBuildingIncome(deps, x, y, buildingId);
}

/**
 * Calculate per-zone-type income breakdown from grid state.
 * Pure function — no side effects, no dependencies on specific classes.
 * Delegates per-building calculation to calculateBuildingIncome (DRY).
 */
export function calculateZoneIncomes(deps: IncomeCalcDeps): ZoneIncomeBreakdown {
  let residential = 0;
  let commercial = 0;
  let industrial = 0;
  let office = 0;

  deps.forEachCell((cell, x, y) => {
    if (!isZoneBuilding(cell.buildingId) || cell.reserved === BURNED || cell.reserved === ABANDONED || cell.reserved === MULTI_CELL_OCCUPIED) return;

    const income = calculateBuildingIncome(deps, x, y, cell.buildingId);
    if (income === 0) return;

    const btype = getBuildingType(cell.buildingId);
    if (!btype) return;

    if (isResidentialZone(btype.zoneType)) {
      residential += income;
    } else if (isCommercialZone(btype.zoneType)) {
      commercial += income;
    } else if (btype.zoneType === ZoneType.INDUSTRIAL) {
      industrial += income;
    } else if (btype.zoneType === ZoneType.OFFICE) {
      office += income;
    }
  });

  return { residential, commercial, industrial, office };
}

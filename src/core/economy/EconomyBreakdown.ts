/**
 * Pure-function economy breakdown calculation (SRP).
 * Extracted from Game.ts — Game should not be responsible for computing economy details.
 */
import { calculateZoneIncomes, type IncomeCalcDeps } from './IncomeCalculator';
import { ECONOMY } from './TaxMultipliers';

/** Minimal context needed for economy breakdown (DIP). */
export interface EconomyBreakdownContext extends IncomeCalcDeps {
  roadTileCount: number;
  loans: number;
  loanInterestRate: number;
  powerMaintenanceCost: number;
  waterMaintenanceCost: number;
  transportOperatingCost: number;
}

export interface EconomyBreakdownResult {
  residential: number;
  commercial: number;
  industrial: number;
  office: number;
  roadMaintenance: number;
  loanInterest: number;
  powerCost: number;
  waterCost: number;
  transportCost: number;
}

/** Round to 1 decimal place. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Compute full economy breakdown from context. Pure function — no side effects. */
export function getEconomyBreakdown(ctx: EconomyBreakdownContext): EconomyBreakdownResult {
  const incomes = calculateZoneIncomes(ctx);
  const roadMaintenance = ctx.roadTileCount * ECONOMY.ROAD_MAINTENANCE_PER_TILE;
  const loanInterest = ctx.loans * ctx.loanInterestRate;

  return {
    residential: r1(incomes.residential),
    commercial: r1(incomes.commercial),
    industrial: r1(incomes.industrial),
    office: r1(incomes.office),
    roadMaintenance: r1(roadMaintenance),
    loanInterest: r1(loanInterest),
    powerCost: ctx.powerMaintenanceCost,
    waterCost: ctx.waterMaintenanceCost,
    transportCost: ctx.transportOperatingCost,
  };
}

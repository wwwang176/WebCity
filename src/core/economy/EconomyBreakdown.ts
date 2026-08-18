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
  /** Sum of all civic service maintenance (police/fire/health/education/parks/...). */
  serviceCost?: number;
  /** District policy upkeep. */
  policyCost?: number;
  /** 條例收到的規費（目前只有壅塞費的過路費）。 */
  policyRevenue?: number;
  /** Elevated road/rail maintenance. */
  elevatedMaintenance?: number;
  /** City specialization revenue multiplier, applied to zone incomes. */
  revenueMultiplier?: number;
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
  serviceCost: number;
  policyCost: number;
  policyRevenue: number;
  elevatedMaintenance: number;
}

/**
 * 面板上「總收入」那一格。
 *
 * 抽成函式而不是寫在 .tsx 的加法裡:漏加一項不會有任何測試轉紅，而漏加的那一項
 * 正好是最新加進來的那一個 —— 條例的規費就是這樣一個新來的加項。
 */
export function panelIncomeTotal(b: EconomyBreakdownResult): number {
  return b.residential + b.commercial + b.industrial + b.office + b.policyRevenue;
}

/** Round to 1 decimal place. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Compute full economy breakdown from context. Pure function — no side effects. */
export function getEconomyBreakdown(ctx: EconomyBreakdownContext): EconomyBreakdownResult {
  const incomes = calculateZoneIncomes(ctx);
  const roadMaintenance = ctx.roadTileCount * ECONOMY.ROAD_MAINTENANCE_PER_TILE;
  const loanInterest = ctx.loans * ctx.loanInterestRate;
  // SimulationLoop scales income by this before writing budget.income; the panel
  // must do the same or it under-reports revenue (BUG-062).
  const mult = ctx.revenueMultiplier ?? 1;

  return {
    residential: r1(incomes.residential * mult),
    commercial: r1(incomes.commercial * mult),
    industrial: r1(incomes.industrial * mult),
    office: r1(incomes.office * mult),
    roadMaintenance: r1(roadMaintenance),
    loanInterest: r1(loanInterest),
    powerCost: ctx.powerMaintenanceCost,
    waterCost: ctx.waterMaintenanceCost,
    transportCost: ctx.transportOperatingCost,
    serviceCost: r1(ctx.serviceCost ?? 0),
    policyCost: r1(ctx.policyCost ?? 0),
    policyRevenue: r1(ctx.policyRevenue ?? 0),
    elevatedMaintenance: r1(ctx.elevatedMaintenance ?? 0),
  };
}

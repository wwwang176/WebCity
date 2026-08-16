import { isPolicyImplemented } from '../district/PolicyManager';
import { policyCost } from '../district/PolicyBilling';
import type { PolicyType } from '../district/types';

/**
 * Calculate total cost of active district policies.
 *
 * Only policies the simulation actually reads are billed. Three of the five
 * (ENCOURAGE_RECYCLING, ORGANIC_FOOD, TOURISM) have no effect anywhere in the
 * codebase, and charging for them was a pure $380/cycle drain the player could
 * not diagnose (BUG-091).
 *
 * 費用由 `POLICY_BILLING` 依規模算出來，不再是存在政策身上的一個常數 —— 固定費用
 * 在大城市等於免費，而且那個數字不會隨玩家把分區畫大而變動，看不出來錢花在哪。
 */
export function calculateDistrictPolicyCost(
  districts: readonly {
    cells: { size: number };
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  population: number,
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      if (!isPolicyImplemented(policy.type)) continue;
      total += policyCost(policy.type, policy.level, {
        population,
        districtCells: district.cells.size,
      });
    }
  }
  return total;
}

export interface ExpenseBreakdown {
  roadMaintenance: number;
  serviceCost: number;
  policyCost: number;
  transportCost: number;
  elevatedMaintenance: number;
}

/** Calculate total expenses from all categories. */
export function calculateTotalExpenses(breakdown: ExpenseBreakdown): number {
  return breakdown.roadMaintenance
    + breakdown.serviceCost
    + breakdown.policyCost
    + breakdown.transportCost
    + breakdown.elevatedMaintenance;
}

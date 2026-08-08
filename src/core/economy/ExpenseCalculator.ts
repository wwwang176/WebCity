import { isPolicyImplemented } from '../district/PolicyManager';
import type { PolicyType } from '../district/types';

/**
 * Calculate total cost of active district policies.
 *
 * Only policies the simulation actually reads are billed. Three of the five
 * (ENCOURAGE_RECYCLING, ORGANIC_FOOD, TOURISM) have no effect anywhere in the
 * codebase, and charging for them was a pure $380/cycle drain the player could
 * not diagnose (BUG-091).
 */
export function calculateDistrictPolicyCost(
  districts: readonly { policies: readonly { active: boolean; cost: number; type: PolicyType }[] }[],
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      if (policy.active && isPolicyImplemented(policy.type)) total += policy.cost;
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

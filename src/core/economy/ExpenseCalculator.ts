/** Calculate total cost of active district policies. */
export function calculateDistrictPolicyCost(
  districts: readonly { policies: readonly { active: boolean; cost: number }[] }[],
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      if (policy.active) total += policy.cost;
    }
  }
  return total;
}

export interface ExpenseBreakdown {
  roadMaintenance: number;
  serviceCost: number;
  policyCost: number;
  transportCost: number;
}

/** Calculate total expenses from all categories. */
export function calculateTotalExpenses(breakdown: ExpenseBreakdown): number {
  return breakdown.roadMaintenance
    + breakdown.serviceCost
    + breakdown.policyCost
    + breakdown.transportCost;
}

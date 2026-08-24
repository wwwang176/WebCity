import { policyCost, policyRevenue, type CityScales } from '../district/PolicyBilling';
import type { PolicyScopeKind } from '../district/PolicyScope';
import { PolicyType } from '../district/types';

/**
 * Calculate total cost of active district policies.
 *
 * Only policies the simulation actually reads are billed. Three of the five
 * (ENCOURAGE_RECYCLING, ORGANIC_FOOD, TOURISM) have no effect anywhere in the
 * codebase, and charging for them was a pure $380/cycle drain the player could
 * not diagnose (BUG-091).
 *
 * Costs come from `POLICY_BILLING` scaled by size rather than from a constant on the policy: a
 * flat fee is free in a large city, and a number that does not move when the player draws a
 * larger district gives no sense of where the money goes.
 */
export function calculateDistrictPolicyCost(
  districts: readonly {
    cells: { size: number };
    /** The count of road cells in this district. Gantries stand on roads, not on land. */
    roadCells: number;
    /** How many commuters pay to drive into this district. A trip crosses one cordon and is
     *  recorded against one district. */
    chargedDrivers: number;
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  city: CityScales,
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      // There was once a separate `isPolicyImplemented` guard here. It was redundant:
      // `policyCost` returns 0 for a type with no billing entry, and every billing entry
      // corresponds to a policy with a real effect — a premise guarded by
      // `PolicyBilling.test.ts`'s `should only bill policies the simulation actually reads`.
      total += policyCost(policy.type, policy.level, {
        ...city,
        districtCells: district.cells.size,
        districtRoadCells: district.roadCells,
        chargedDrivers: district.chargedDrivers,
      });
    }
  }
  return total;
}

/**
 * Total policy spending this period: district policies plus city ordinances.
 *
 * Extracted because it has two consumers, the simulation loop's budget and the budget panel.
 * Written as an addition in each, adding city ordinances reaches one of them and the panel and
 * the ledger silently differ by a number.
 */
export function totalPolicyExpense(
  districts: readonly {
    cells: { size: number };
    /** The count of road cells in this district. Gantries stand on roads, not on land. */
    roadCells: number;
    /** How many commuters pay to drive into this district. A trip crosses one cordon and is
     *  recorded against one district. */
    chargedDrivers: number;
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  ordinances: { totalCost(city: CityScales): number },
  city: CityScales,
): number {
  return calculateDistrictPolicyCost(districts, city) + ordinances.totalCost(city);
}

/**
 * Total policy revenue this period: district policies plus city ordinances.
 *
 * Symmetric with `totalPolicyExpense`. One policy can appear on both sides — the congestion
 * charge's gantries need upkeep while its tolls are collected — so each side is summed separately
 * rather than netted: a net figure becomes one line on the ledger with no visible composition,
 * and where the money comes from and goes is exactly what the player is asking.
 */
export function totalPolicyRevenue(
  districts: readonly {
    cells: { size: number };
    /** The count of road cells in this district. Gantries stand on roads, not on land. */
    roadCells: number;
    /** How many commuters pay to drive into this district. A trip crosses one cordon and is
     *  recorded against one district. */
    chargedDrivers: number;
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  ordinances: { getLevel(t: PolicyType): number },
  city: CityScales,
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      total += policyRevenue(policy.type, policy.level, {
        ...city, districtCells: district.cells.size, districtRoadCells: district.roadCells,
        chargedDrivers: district.chargedDrivers,
      });
    }
  }
  for (const type of Object.values(PolicyType)) {
    // A city ordinance has no charging zone, so all three district quantities are 0.
    total += policyRevenue(type, ordinances.getLevel(type),
      { ...city, districtCells: 0, districtRoadCells: 0, chargedDrivers: 0 });
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

/** One policy spending line in the budget panel. */
export interface PolicyExpenseLine {
  type: PolicyType;
  scope: PolicyScopeKind;
  /** `null` for a city ordinance. */
  districtName: string | null;
  level: number;
  cost: number;
  /**
   * What this policy collected this period. 0 means it does not earn.
   *
   * Alongside `cost` rather than netted with it: the congestion charge's gantry fees and its tolls
   * follow entirely different things — how large the zone is against how many people still drive
   * — and one number cannot show why this month turned from a profit into a loss.
   */
  revenue: number;
}

/**
 * Lists this period's policy spending line by line.
 *
 * With only a total in the budget panel, policies rising from $800 to $4,200 is a hole the player
 * discovers afterwards. Visibility is what makes a decision possible, and it is also the premise
 * of having no spending cap: a cap cuts the player's policies for them, and does it silently.
 *
 * The lines have to sum to `totalPolicyExpense` for the same `population`, or the explanation the
 * player reads is false. Lines costing 0 are omitted: restrictive ordinances charge nothing, and
 * a $0 line reads as a free benefit.
 */
export function listPolicyExpenses(
  districts: readonly {
    name: string;
    cells: { size: number };
    /** The count of road cells in this district. Gantries stand on roads, not on land. */
    roadCells: number;
    /** How many commuters pay to drive into this district. A trip crosses one cordon and is
     *  recorded against one district. */
    chargedDrivers: number;
    policies: readonly { type: PolicyType; level: number }[];
  }[],
  ordinances: { getLevel(t: PolicyType): number },
  city: CityScales,
): PolicyExpenseLine[] {
  const out: PolicyExpenseLine[] = [];
  for (const d of districts) {
    for (const p of d.policies) {
      const scale = {
        ...city, districtCells: d.cells.size, districtRoadCells: d.roadCells,
        chargedDrivers: d.chargedDrivers,
      };
      const cost = policyCost(p.type, p.level, scale);
      const revenue = policyRevenue(p.type, p.level, scale);
      if (cost === 0 && revenue === 0) continue;
      out.push({
        type: p.type, scope: 'district', districtName: d.name, level: p.level, cost, revenue,
      });
    }
  }
  for (const type of Object.values(PolicyType)) {
    const level = ordinances.getLevel(type);
    const scale = { ...city, districtCells: 0, districtRoadCells: 0, chargedDrivers: 0 };
    const cost = policyCost(type, level, scale);
    const revenue = policyRevenue(type, level, scale);
    if (cost === 0 && revenue === 0) continue;
    out.push({ type, scope: 'city', districtName: null, level, cost, revenue });
  }
  return out;
}

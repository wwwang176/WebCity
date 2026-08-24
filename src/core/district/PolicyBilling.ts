import { PolicyType } from './types';
import { maxLevel } from './PolicyManager';
import { LifeStage, type Citizen } from '../citizen/types';
import { parsePosKey } from '../grid/GridHelpers';

/** Which scale the fee follows. */
export type BillingBasis =
  | 'flat' | 'population' | 'districtCells' | 'childcareRecipients' | 'clinicPatients'
  | 'chargedDrivers' | 'districtRoadCells';

/**
 * Each life stage's weight in free-clinic attendance, with adults at 1.
 *
 * The old and the very young account for most healthcare spending, which is the shape of the
 * real age distribution of medical costs. Pricing by total population gives a young city and an
 * ageing one the same clinic bill, and that difference is the one this ordinance should make the
 * player feel.
 */
export const CLINIC_AGE_WEIGHT: Record<LifeStage, number> = {
  [LifeStage.BABY]: 2.5,
  [LifeStage.CHILD]: 1.2,
  [LifeStage.TEEN]: 0.8,
  [LifeStage.ADULT]: 1,
  [LifeStage.SENIOR]: 3,
};

/**
 * City-wide scales. Subsidy ordinances are billed on the people who actually receive them.
 *
 * With population as the only scale, a childcare subsidy costs full price in a city with no
 * children: money nobody receives, and no visible difference between the ordinance being on and
 * off.
 */
export interface CityScales {
  /** The city's population. */
  population: number;
  babies: number;
  children: number;
  teens: number;
  /**
   * The population inside hospital coverage, weighted by age.
   *
   * People outside coverage do not count: where no hospital reaches, nobody attends and no
   * subsidy is paid. The same applies to the homeless, who have no address to check coverage
   * against.
   */
  clinicPatients: number;
}

/** The scales billing needs. The caller fills them in. */
export interface PolicyScale extends CityScales {
  /** The cell count of this policy's district. 0 for a city ordinance. */
  districtCells: number;
  /**
   * The count of **road** cells in this district. 0 for a city ordinance.
   *
   * Gantries stand on roads, not on land, so enclosing a green field should produce no gantry
   * upkeep at all.
   */
  districtRoadCells: number;
  /**
   * How many commuters pay to drive into **this district**. 0 for a city ordinance.
   *
   * The only **flow** basis; every other one is a stock — how many people, cells or patients.
   * Revenue follows it so the ordinance earns less the better it works; following cell count
   * would turn a large charging zone over open country into a money printer.
   *
   * A per-district quantity rather than a city-wide one: a trip passes one cordon. At the city
   * level, every charging zone would multiply by the whole city's paying drivers and drawing two
   * would charge twice.
   */
  chargedDrivers: number;
}

/**
 * Computes the city-wide scales from the citizen list.
 *
 * In one pass: a separate scan per quantity would walk a hundred thousand citizens four extra
 * times every budget period.
 */
export function computeCityScales(
  citizens: readonly Citizen[],
  isHealthCovered: (x: number, y: number) => boolean,
): CityScales {
  let babies = 0, children = 0, teens = 0, clinicPatients = 0;
  for (const c of citizens) {
    if (c.lifeStage === LifeStage.BABY) babies++;
    else if (c.lifeStage === LifeStage.CHILD) children++;
    else if (c.lifeStage === LifeStage.TEEN) teens++;

    if (!c.homeId) continue;
    const pos = parsePosKey(c.homeId);
    if (!pos || !isHealthCovered(pos.x, pos.y)) continue;
    clinicPatients += CLINIC_AGE_WEIGHT[c.lifeStage];
  }
  return { population: citizens.length, babies, children, teens, clinicPatients };
}

/**
 * How each ordinance is billed.
 *
 * No entry means no fee. Restrictive ordinances — banning heavy industry or high density —
 * belong in that group: their cost is the opportunity cost of the high-tax buildings the
 * district cannot grow, not money out of the treasury. Charging as well would be a double
 * penalty, and that number would have no basis.
 *
 * `perUnit` has one entry per level, index 0 being level 1, and its length must equal
 * `maxLevel(type)`. If the two tables drift apart, level 3 silently charges level 2's price.
 *
 * A flat fee is free in a large city: a constraint early on and imperceptible later. Following a
 * scale gives the fee a basis, and "the more successful the policy, the more it costs" is itself
 * a tension the player has to decide when to stop paying.
 */
export const POLICY_BILLING: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { basis: 'districtCells', perUnit: [1.5, 4, 9] },
  [PolicyType.TOURISM]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.ORGANIC_FOOD]: { basis: 'districtCells', perUnit: [2] },
  // A city ordinance has no district cell count; it serves the whole city, so it is billed by
  // population.
  [PolicyType.ENERGY_REGULATION]: { basis: 'population', perUnit: [0.08, 0.22, 0.5] },
  [PolicyType.LEGALIZE_GAMBLING]: { basis: 'districtCells', perUnit: [4] },
  [PolicyType.NIGHT_ECONOMY]: { basis: 'districtCells', perUnit: [2, 5] },
  [PolicyType.CURFEW]: { basis: 'districtCells', perUnit: [1.5, 4] },
  [PolicyType.HERITAGE_PRESERVATION]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.INDUSTRY_SUBSIDY]: { basis: 'districtCells', perUnit: [3, 7] },
  [PolicyType.SURVEILLANCE_NETWORK]: { basis: 'population', perUnit: [0.06, 0.15] },
  [PolicyType.PAY_AS_YOU_THROW]: { basis: 'population', perUnit: [0.05, 0.12] },
  [PolicyType.WATER_CONSERVATION]: { basis: 'population', perUnit: [0.07, 0.18, 0.42] },
  [PolicyType.SEWAGE_STANDARDS]: { basis: 'population', perUnit: [0.09, 0.24] },
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: { basis: 'districtCells', perUnit: [2, 5, 11] },
  /**
   * The childcare subsidy is paid per head: every eligible child receives the same amount each
   * period, so the unit price is identical across the three levels. What the level changes is
   * **who is eligible**, the question this ordinance actually asks, and that shows up in the
   * basis rather than the price.
   */
  [PolicyType.CHILDCARE_SUBSIDY]: { basis: 'childcareRecipients', perUnit: [1.2, 1.2, 1.2] },
  // Paid as far as it reaches. Superlinear, because a university place costs more per head than
  // a primary school one.
  [PolicyType.COMPULSORY_EDUCATION]: { basis: 'population', perUnit: [0.08, 0.20, 0.45] },
  // Clinics are billed on the patients they actually see: an ageing city's bill should be
  // heavier than a young city's, and pricing by total population erases that difference.
  [PolicyType.FREE_CLINIC]: { basis: 'clinicPatients', perUnit: [0.35, 0.85] },
  // The smoking ban costs only enforcement. Its real price is in the commercial revenue column.
  [PolicyType.SMOKING_BAN]: { basis: 'population', perUnit: [0.02] },
  // Gantries and enforcement follow the district's **road** cell count rather than its total:
  // gantries stand on roads, and enclosing a green field should produce no upkeep.
  [PolicyType.CONGESTION_CHARGE]: { basis: 'districtRoadCells', perUnit: [0.8, 1.8] },
};

/**
 * How many units this basis has at this level.
 *
 * `level` is for bases whose scope widens with the level: the childcare subsidy counts as far as
 * it reaches. That mapping lives here rather than in the effect table, because it is a billing
 * rule and not a simulation effect.
 */
function unitsOf(basis: BillingBasis, scale: PolicyScale, level: number): number {
  switch (basis) {
    case 'flat': return 1;
    case 'population': return scale.population;
    case 'districtCells': return scale.districtCells;
    case 'childcareRecipients':
      return scale.babies
        + (level >= 2 ? scale.children : 0)
        + (level >= 3 ? scale.teens : 0);
    case 'clinicPatients': return scale.clinicPatients;
    case 'chargedDrivers': return scale.chargedDrivers;
    case 'districtRoadCells': return scale.districtRoadCells;
  }
}

/**
 * What each ordinance **earns** at each level.
 *
 * A separate table rather than a signed unit price, because one ordinance can have both: the
 * congestion charge's gantries need upkeep (following the zone's road cells) while its tolls are
 * collected (following the people still driving). A single signed number cannot express two
 * directions following different scales.
 *
 * Separating them has a second benefit: the billing table's existing invariants — unit prices
 * are positive and rise with level — keep guarding spending unchanged, and revenue has its own
 * set of the same shape.
 */
export const POLICY_REVENUE: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  // Tolls follow how many people are still driving, so the more successful the policy the less
  // it collects; taken to its limit it loses money, because the gantries still need upkeep. That
  // is the judgement this ordinance asks of the player.
  [PolicyType.CONGESTION_CHARGE]: { basis: 'chargedDrivers', perUnit: [0.04, 0.09] },
};

function amountOf(
  table: Partial<Record<PolicyType, { basis: BillingBasis; perUnit: readonly number[] }>>,
  type: PolicyType, level: number, scale: PolicyScale,
): number {
  if (level <= 0) return 0;
  const entry = table[type];
  if (!entry) return 0;
  const perUnit = entry.perUnit[Math.min(level, maxLevel(type)) - 1];
  if (perUnit === undefined) return 0;
  return perUnit * unitsOf(entry.basis, scale, level);
}

/** What this ordinance costs per budget period at this level and scale. */
export function policyCost(type: PolicyType, level: number, scale: PolicyScale): number {
  return amountOf(POLICY_BILLING, type, level, scale);
}

/** What this ordinance collects per budget period at this level and scale. */
export function policyRevenue(type: PolicyType, level: number, scale: PolicyScale): number {
  return amountOf(POLICY_REVENUE, type, level, scale);
}

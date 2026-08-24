import { Policy, PolicyType, type District } from './types';
import { ZoneType } from '../grid/types';
import { isDistrictScoped } from './PolicyScope';
import { conflictsWith } from './PolicyExclusion';

/** Minimal interface for district lookup (DIP). */
export interface DistrictLookup {
  getDistrict(id: string): District | undefined;
}

/** Consolidated per-policy-type configuration (OCP-friendly). */
export interface PolicyTypeConfig {
  name: string;
}

/** Single source of truth for all policy type parameters. */
export const POLICY_CONFIG: Record<PolicyType, PolicyTypeConfig> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: { name: 'No Heavy Industry' },
  [PolicyType.ENCOURAGE_RECYCLING]: { name: 'Encourage Recycling' },
  [PolicyType.HIGH_DENSITY_BAN]: { name: 'High Density Ban' },
  [PolicyType.ORGANIC_FOOD]: { name: 'Organic Food' },
  [PolicyType.TOURISM]: { name: 'Tourism Promotion' },
  [PolicyType.ENERGY_REGULATION]: { name: 'Energy Regulation' },
  [PolicyType.LEGALIZE_GAMBLING]: { name: 'Legalize Gambling' },
  [PolicyType.NIGHT_ECONOMY]: { name: 'Night Economy' },
  [PolicyType.CURFEW]: { name: 'Curfew' },
  [PolicyType.HERITAGE_PRESERVATION]: { name: 'Heritage Preservation' },
  [PolicyType.INDUSTRY_SUBSIDY]: { name: 'Industry Subsidy' },
  [PolicyType.SURVEILLANCE_NETWORK]: { name: 'Surveillance Network' },
  [PolicyType.PAY_AS_YOU_THROW]: { name: 'Pay As You Throw' },
  [PolicyType.WATER_CONSERVATION]: { name: 'Water Conservation' },
  [PolicyType.SEWAGE_STANDARDS]: { name: 'Sewage Standards' },
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: { name: 'Industrial Emission Control' },
  [PolicyType.CHILDCARE_SUBSIDY]: { name: 'Childcare Subsidy' },
  [PolicyType.COMPULSORY_EDUCATION]: { name: 'Compulsory Education' },
  [PolicyType.FREE_CLINIC]: { name: 'Free Clinics' },
  [PolicyType.SMOKING_BAN]: { name: 'Smoking Ban' },
  [PolicyType.CONGESTION_CHARGE]: { name: 'Congestion Charge' },
};

/**
 * Data-driven zone restrictions per policy type (OCP).
 * Adding a new zone-restricting policy only requires a new entry here.
 */
export const POLICY_ZONE_RESTRICTIONS: Partial<Record<PolicyType, ReadonlySet<ZoneType>>> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: new Set([ZoneType.INDUSTRIAL]),
  [PolicyType.HIGH_DENSITY_BAN]: new Set([ZoneType.RESIDENTIAL_HIGH, ZoneType.COMMERCIAL_HIGH]),
};

/**
 * What each non-zoning policy does, in the units the consumer uses.
 *
 * Three of the five policies did nothing at all: a repo-wide search for
 * ENCOURAGE_RECYCLING, ORGANIC_FOOD and TOURISM found only this file and its
 * tests. They were billed every budget cycle regardless — $380 for nothing,
 * with the district modal advertising the prices as though they bought
 * something (BUG-091). Hiding them from the UI was the stopgap; this table is
 * the implementation.
 *
 * Each is deliberately a small effect on a number the player can already read
 * off a panel, so "did that policy do anything?" is answerable by looking.
 */
export interface PolicyEffect {
  /** Multiplier on garbage produced in the district. */
  garbage?: number;
  /** Multiplier on tax revenue from every building in the district. */
  revenue?: number;
  /** Flat addition to land value before the usual clamp. */
  landValue?: number;
  /**
   * A revenue multiplier applying only to certain zone types.
   *
   * `revenue` treats every zone alike and cannot express "commercial only", while most policies'
   * costs fall on particular industries: recycling adds to a shop's disposal costs and has
   * nothing to do with households.
   */
  revenueByZone?: Partial<Record<ZoneType, number>>;
  /**
   * What this adds to the district's crime rate. Positive is a cost, in the same units as
   * `calculateLandValue`'s `crimeRate`.
   *
   * `PoliceService` offers only `getCrimeReduction`, so nothing in the simulation can make crime
   * **rise** and a trade of more revenue for more crime cannot be expressed. This field is that
   * gap.
   */
  crime?: number;
  /**
   * The multiplier on the city's total power demand.
   *
   * This is a **city-level pool**: conservation required in half the city still feeds the same
   * grid, so where it applies is not a decision. Any policy carrying this field is necessarily
   * city-scoped.
   */
  powerDemand?: number;
  /** The city-wide multiplier on per-cell water demand. */
  waterDemand?: number;
  /** The city-wide multiplier on per-cell sewage discharge. */
  sewageLoad?: number;
  /** The multiplier on ground pollution from industrial cells. */
  industrialPollution?: number;
  /**
   * The city-wide multiplier on birth probability.
   *
   * Births are one roll per citizen, so this multiplies the probability itself rather than a
   * count: multiplying a count would produce children in a city with no adults of childbearing
   * age.
   */
  fertility?: number;
  /**
   * How far compulsory schooling reaches as a school stage: 1 primary, 2 through high school, 3
   * through university.
   *
   * A stage rather than a speed multiplier, because what the levels distinguish is **how far it
   * reaches**, not how hard it is pushed. Three multipliers would make "compulsory to primary"
   * and "compulsory to university" the same thing at different strengths, accelerating university
   * students too, and there would be no "how far" left.
   */
  compulsorySchooling?: number;
  /**
   * The city-wide multiplier on death probability, applying to everyone.
   *
   * Two fields rather than one with a flag: the wiring point is the death-roll callback, which
   * already branches three ways on whether the citizen is within hospital coverage. Each field
   * multiplies into its own branch, which is one check and one way to get it wrong fewer than a
   * single field plus a "does coverage matter" flag.
   */
  deathRate?: number;
  /**
   * A death probability multiplier applying only **inside hospital coverage**.
   *
   * Where no hospital reaches, nobody attends and no subsidy is paid. So free clinics reinforce
   * hospitals rather than replacing them: there has to be a hospital first for this to reinforce.
   */
  coveredDeathRate?: number;
  /**
   * How much driving is multiplied by in a citizen's reckoning under a congestion charge. 1 means
   * no charge.
   *
   * It affects only the **comparison**, not the actual commute time: a charge does not slow cars
   * down. So people with transit available switch to it, people without keep driving, and the
   * district's shops simply lose a few customers.
   */
  driveDeterrence?: number;
}

/**
 * What each ordinance does at each level. Index 0 is level 1; binary ordinances hold one entry.
 *
 * Recycling as a pure benefit is not a decision but a price list: affordable means always on.
 * Every level now costs commercial revenue as well, and the **cost per unit rises with the
 * level** — level 3 pays more revenue per 1% of refuse removed than level 1 — so the strongest
 * level is not automatically the best choice.
 *
 * The cost sits in `revenueByZone` rather than `revenue`: recycling adds to a shop's disposal
 * costs and has nothing to do with households.
 */
export const POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    // -15% refuse for 2% of commercial revenue: 0.133 per unit
    { garbage: 0.85, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98 } },
    // -35% for 8%: 0.229
    { garbage: 0.65, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92 } },
    // -55% for 18%: 0.327
    { garbage: 0.45, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.82, [ZoneType.COMMERCIAL_HIGH]: 0.82 } },
  ],
  // Tourism brings crowds and crowds bring crime. That is its price, not money from the
  // treasury.
  [PolicyType.TOURISM]: [{ revenue: 1.2, crime: 4 }],
  // Organic food makes the district more liveable at the cost of shops' supply prices.
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95, [ZoneType.COMMERCIAL_HIGH]: 0.95 } }],
  /**
   * Energy regulation. Acts on the grid's **total demand**, with the cost falling on commerce
   * and industry, who absorb equipment upgrades and process changes. Industry is charged more
   * heavily than commerce: re-engineering a process costs far more than replacing air
   * conditioning.
   */
  [PolicyType.ENERGY_REGULATION]: [
    { powerDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { powerDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { powerDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],

  /**
   * Gambling and the curfew are a deliberate pair: one plot of land takes one side. Gambling
   * opens the nightlife up for money; the curfew shuts it down for safety.
   */
  [PolicyType.LEGALIZE_GAMBLING]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.35, [ZoneType.COMMERCIAL_HIGH]: 1.35 }, crime: 12 },
  ],
  // A milder gambling, in two levels. Level 2 pays more crime per 1% of revenue than level 1.
  [PolicyType.NIGHT_ECONOMY]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.12, [ZoneType.COMMERCIAL_HIGH]: 1.12 }, crime: 4 },
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.25, [ZoneType.COMMERCIAL_HIGH]: 1.25 }, crime: 10 },
  ],
  [PolicyType.CURFEW]: [
    { crime: -5, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.90, [ZoneType.COMMERCIAL_HIGH]: 0.90 } },
    { crime: -10, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.78, [ZoneType.COMMERCIAL_HIGH]: 0.78 } },
  ],
  // Height limits and appearance rules apply to everyone, so housing pays too, more lightly than
  // commerce.
  [PolicyType.HERITAGE_PRESERVATION]: [
    {
      landValue: 12,
      revenueByZone: {
        [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92,
        [ZoneType.RESIDENTIAL_LOW]: 0.94, [ZoneType.RESIDENTIAL_HIGH]: 0.94,
      },
    },
  ],
  // The subsidy buys factory expansion at the cost of land value: nobody wants to live beside
  // it.
  [PolicyType.INDUSTRY_SUBSIDY]: [
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.12 }, landValue: -4 },
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.25 }, landValue: -9 },
  ],

  // Safety for privacy. The land value cost is deliberate: without it this becomes a price list
  // for buying safety.
  [PolicyType.SURVEILLANCE_NETWORK]: [
    { crime: -6, landValue: -2 },
    { crime: -13, landValue: -5 },
  ],
  // Pay-as-you-throw. Less refuse, more resentment.
  [PolicyType.PAY_AS_YOU_THROW]: [
    { garbage: 0.78, landValue: -3 },
    { garbage: 0.58, landValue: -7 },
  ],
  // The water saved is real: lower per-cell demand carries one plant's budget further. The cost
  // falls on businesses, and re-engineering industrial process water costs far more than fitting
  // low-flow taps in a shop.
  [PolicyType.WATER_CONSERVATION]: [
    { waterDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { waterDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { waterDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],
  // Discharge standards act on processes, so the cost falls on industry alone: a household
  // changes a tap, a factory changes a whole treatment line.
  [PolicyType.SEWAGE_STANDARDS]: [
    { sewageLoad: 0.85, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.96 } },
    { sewageLoad: 0.70, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.90 } },
  ],
  // Ground pollution only. A factory's noise comes from its machinery rather than its
  // discharges, and lowering noise too would make this a universal "industry gets clean" button
  // rather than a trade-off.
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    { industrialPollution: 0.80, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.95 } },
    { industrialPollution: 0.60, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.88 } },
    { industrialPollution: 0.40, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.78 } },
  ],

  /**
   * The childcare subsidy. Public nurseries and payments make households willing to have
   * children, funded by a levy on employers, so the cost falls on commerce and industry and
   * leaves housing alone: the beneficiaries are the people living there.
   *
   * The extra babies do not become a tax base immediately. They occupy housing capacity, do not
   * work, and enter the labour market only as adults. That delay is this ordinance's real wager,
   * and it is already in the simulation rather than in this table.
   *
   * The three levels are **how old a child is supported to**: infants, through childhood, through
   * adolescence. Real childcare payments are always age-bounded and budgeted per eligible child;
   * no country budgets a flat childcare sum against total population. Longer support makes
   * households more willing, so fertility rises with the stage.
   */
  [PolicyType.CHILDCARE_SUBSIDY]: [
    { fertility: 1.20, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98, [ZoneType.INDUSTRIAL]: 0.98 } },
    { fertility: 1.45, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95, [ZoneType.COMMERCIAL_HIGH]: 0.95, [ZoneType.INDUSTRIAL]: 0.95 } },
    { fertility: 1.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.91, [ZoneType.COMMERCIAL_HIGH]: 0.91, [ZoneType.INDUSTRIAL]: 0.91 } },
  ],

  /**
   * Compulsory education. The three levels match the three school stages; the game has no
   * separate middle school, so high school follows primary directly.
   *
   * The cost falls on industry alone: with education raised, fewer people are willing to work in
   * a factory. And each level costs more than the last in proportion (3% to 7% to 14%), so
   * running it all the way to university is not automatically the best answer.
   */
  [PolicyType.COMPULSORY_EDUCATION]: [
    { compulsorySchooling: 1, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.97 } },
    { compulsorySchooling: 2, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.93 } },
    { compulsorySchooling: 3, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.86 } },
  ],

  /**
   * Free clinics and the smoking ban are a deliberate pair: both buy health, and they differ in
   * who pays.
   *
   * Clinics come out of the treasury, billed on weighted patient numbers and the most expensive
   * entry in the table, and only graze commerce, since a public free clinic draws patients away
   * from private practice. The smoking ban costs the treasury almost nothing and is paid for by
   * restaurants and the night economy instead.
   *
   * Both can run at once and their effects multiply: they are not two answers to one decision but
   * two ways of funding one goal.
   */
  [PolicyType.FREE_CLINIC]: [
    { coveredDeathRate: 0.88, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98 } },
    { coveredDeathRate: 0.75, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95, [ZoneType.COMMERCIAL_HIGH]: 0.95 } },
  ],
  [PolicyType.SMOKING_BAN]: [
    { deathRate: 0.94, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.88, [ZoneType.COMMERCIAL_HIGH]: 0.88 } },
  ],

  /**
   * The congestion charge. The cost falls on commerce inside the charging zone, which loses the
   * customers who drove in.
   *
   * It reduces traffic only where there is **something to switch to**: in a charging zone with no
   * transit, the cars keep coming and the shops still pay. That is not a defect but this
   * ordinance's premise — build the network first, then charge.
   */
  [PolicyType.CONGESTION_CHARGE]: [
    { driveDeterrence: 1.30, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95, [ZoneType.COMMERCIAL_HIGH]: 0.95 } },
    { driveDeterrence: 1.75, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.88, [ZoneType.COMMERCIAL_HIGH]: 0.88 } },
  ],
};

/**
 * Policies implemented by something other than a zone restriction — derived
 * from the effect table, so adding an effect is all it takes to make a policy
 * real, and a policy with no effect can never be offered.
 */
const NON_ZONE_IMPLEMENTED_POLICY_TYPES: readonly PolicyType[] =
  Object.keys(POLICY_EFFECTS) as PolicyType[];

/**
 * Policies the simulation actually reads — DERIVED, not a hand-kept list.
 *
 * A repo-wide search for the other three enum members (ENCOURAGE_RECYCLING,
 * ORGANIC_FOOD, TOURISM) finds only this file and its tests — nothing in
 * GarbageService, Pollution, LandValue, Happiness or the income path consults
 * them. They were still billed every budget cycle, $380 for nothing, while the
 * district modal advertised their prices as though they did something (BUG-091).
 *
 * The first fix wrote the two real policies out by hand, which made this the
 * third list needing manual sync (POLICY_CONFIG and DistrictModal being the
 * others) and made the test that "checked" it a tautology — a subset assertion
 * over a set literally built from those members. Deriving it from the
 * restriction table removes the sync obligation entirely.
 */
export const IMPLEMENTED_POLICY_TYPES: ReadonlySet<PolicyType> = new Set<PolicyType>([
  ...(Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]),
  ...NON_ZONE_IMPLEMENTED_POLICY_TYPES,
]);

/** Does this policy have an effect on the simulation? */
export function isPolicyImplemented(type: PolicyType): boolean {
  return IMPLEMENTED_POLICY_TYPES.has(type);
}

/**
 * Which level a pre-levels `active: true` maps to.
 *
 * Before levels, each policy had one set of numbers. Converting everything to level 1 silently
 * weakens, on load, any policy whose numbers were not the first entry: recycling was
 * `garbage: 0.65`, and 0.65 is the new table's **level 2**. Converted to level 1, a player who
 * changed nothing goes from -35% refuse to -15% and gains a 2% commercial revenue cost.
 *
 * Anything not listed here is 1, because its old numbers were already the first entry.
 */
const LEGACY_ACTIVE_LEVEL: Partial<Record<PolicyType, number>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: 2,
};

/** The level an older save's `active` flag maps to. */
export function levelForLegacyActive(type: PolicyType, active: boolean | undefined): number {
  if (!active) return 0;
  return LEGACY_ACTIVE_LEVEL[type] ?? 1;
}

/**
 * Clamps an arbitrary number into a valid level.
 *
 * A save is a file the user can edit, and `Policy.level` is declared `0 | 1 | 2 | 3`. Unclamped,
 * `-1`, `4`, a fraction or `NaN` breaks that invariant, which TypeScript only sees at compile
 * time. `Math.max(0, NaN)` is still `NaN`, so non-finite values are rejected first.
 */
export function clampLevel(level: number, max: number): Policy['level'] {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(max, Math.floor(level))) as Policy['level'];
}

/**
 * This policy's highest level.
 *
 * Derived from the effect table's length rather than written by hand: a hand-written copy will
 * eventually drift from the table, and the day it does there is no symptom — the extra level
 * silently applies the last entry's effect.
 *
 * Policies with no effect table entry, the restrictive ones, are binary with a maximum of 1.
 */
export function maxLevel(type: PolicyType): number {
  return POLICY_EFFECTS[type]?.length ?? 1;
}

/**
 * How much a trip's reluctance to drive is multiplied by under a congestion charge.
 *
 * Either end inside a charging zone counts: the charge is collected at a cordon, and driving in
 * and driving out are one trip.
 *
 * With both ends inside, the higher of the two is taken and **not the product**: someone whose
 * whole trip is inside crosses one cordon, multiplying charges them twice, and that person has
 * the fewest alternatives of anyone, with home and work both inside and no guarantee of a stop
 * nearby.
 *
 * Extracted into its own function because the call site does a single coordinate lookup, where
 * the both-ends case is invisible: multiplying and taking the maximum give identical answers
 * whenever only one end is charged.
 */
export function tripDriveDeterrence(fromDeterrence: number, toDeterrence: number): number {
  return Math.max(fromDeterrence, toDeterrence);
}

export class PolicyManager {
  private districtLookup: DistrictLookup;
  private nextPolicyId = 1;

  constructor(districtLookup: DistrictLookup) {
    this.districtLookup = districtLookup;
  }

  /**
   * Sets one policy's level in one district. 0 turns it off.
   *
   * An existing entry has its level changed in place rather than gaining a second: exclusivity
   * rests on one record per type, each with one level.
   *
   * Level 0 with no existing entry does nothing: a level-0 record is litter and makes the count
   * of which policies a district has inaccurate.
   */
  setPolicyLevel(districtId: string, policyType: PolicyType, level: number): void {
    // A city ordinance on a district is meaningless, and settable at both levels its effect
    // doubles silently.
    if (!isDistrictScoped(policyType)) return;
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;
    const clamped = clampLevel(level, maxLevel(policyType));

    // Enabling one switches the rest of its group off. Only when actually enabling: switching
    // one off must not sweep away the others, which would make "off" a button with collateral
    // damage.
    if (clamped > 0) {
      for (const other of conflictsWith(policyType)) {
        const p = district.policies.find((x) => x.type === other);
        if (p) p.level = 0;
      }
    }

    const existing = district.policies.find((p) => p.type === policyType);
    if (existing) {
      existing.level = clamped;
      return;
    }
    if (clamped === 0) return;

    const cfg = POLICY_CONFIG[policyType];
    const policy: Policy = {
      id: `policy_${this.nextPolicyId++}`,
      name: cfg.name,
      type: policyType,
      level: clamped,
    };
    district.policies.push(policy);
  }

  /** What level this policy is at in this district. 0 for no district and for no such policy. */
  getPolicyLevel(districtId: string | null, policyType: PolicyType): number {
    if (!districtId) return 0;
    return this.districtLookup.getDistrict(districtId)
      ?.policies.find((p) => p.type === policyType)?.level ?? 0;
  }

  removePolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;

    district.policies = district.policies.filter((p) => p.type !== policyType);
  }

  isPolicyActive(districtId: string, policyType: PolicyType): boolean {
    return this.getPolicyLevel(districtId, policyType) > 0;
  }

  /**
   * Combined effect of a district's active policies on one quantity.
   *
   * `districtId` is nullable because most callers ask about a CELL, and most
   * cells are in no district at all — those get the identity value rather than
   * a special case at every call site.
   */
  private effect(
    districtId: string | null,
    pick: (e: PolicyEffect) => number | undefined,
    identity: number,
    combine: (a: number, b: number) => number,
  ): number {
    if (!districtId) return identity;
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return identity;

    let out = identity;
    for (const policy of district.policies) {
      if (policy.level === 0) continue;
      const tier = POLICY_EFFECTS[policy.type]?.[policy.level - 1];
      const value = tier && pick(tier);
      if (value !== undefined) out = combine(out, value);
    }
    return out;
  }

  /** Multiplier on garbage produced by buildings in this district. */
  getGarbageMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.garbage, 1, (a, b) => a * b);
  }

  /**
   * Multiplier on tax revenue from buildings of this zone type in this district.
   *
   * `revenue`, which treats every zone alike, and `revenueByZone`, which targets particular
   * industries, are combined in one pass. Two `effect()` calls would look the district up twice
   * and scan the policies twice, on a path walked per building on every income calculation.
   */
  getRevenueMultiplier(districtId: string | null, zoneType: ZoneType): number {
    return this.effect(districtId, (e) => {
      const flat = e.revenue;
      const byZone = e.revenueByZone?.[zoneType];
      if (flat === undefined && byZone === undefined) return undefined;
      return (flat ?? 1) * (byZone ?? 1);
    }, 1, (a, b) => a * b);
  }

  /** Flat land-value bonus for cells in this district. */
  getLandValueBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.landValue, 0, (a, b) => a + b);
  }

  /** The multiplier on ground pollution from this district's industrial cells. */
  getIndustrialPollutionMultiplier(districtId: string | null): number {
    return this.effect(districtId, e => e.industrialPollution, 1, (a, b) => a * b);
  }

  /**
   * The multiplier on the cost of driving under a congestion charge. 1 means this district does
   * not charge.
   *
   * This is a cost in a citizen's reckoning, not time on the road: consumers compare with it and
   * never report a commute time from it.
   */
  getDriveDeterrence(districtId: string | null): number {
    return this.effect(districtId, e => e.driveDeterrence, 1, (a, b) => a * b);
  }

  getCrimeBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.crime, 0, (a, b) => a + b);
  }

  /**
   * Policy objects themselves live on their District, so only the id counter
   * needs persisting here — without it, policies created after a load would
   * reuse ids already present on restored districts (BUG-053).
   */
  toJSON(): { nextPolicyId: number } {
    return { nextPolicyId: this.nextPolicyId };
  }

  restore(data: { nextPolicyId?: number } | undefined): void {
    if (data?.nextPolicyId != null) this.nextPolicyId = data.nextPolicyId;
  }

  canBuildInDistrict(districtId: string, buildingZoneType: ZoneType): boolean {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return true;

    // Data-driven zone restrictions (OCP: adding new policies only needs POLICY_ZONE_RESTRICTIONS entry)
    for (const [policyType, blockedZones] of Object.entries(POLICY_ZONE_RESTRICTIONS)) {
      if (blockedZones!.has(buildingZoneType) && this.isPolicyActive(districtId, policyType as PolicyType)) {
        return false;
      }
    }

    return true;
  }
}

import { PolicyType } from './types';

/** A policy's scope. */
export type PolicyScopeKind = 'district' | 'city';

/**
 * Each policy's scope.
 *
 * The test: **if applying it to the whole map is never worse than applying it to part, it is
 * city-wide**. Where is then not a decision, and requiring a district first is only extra clicks.
 * Conversely, a congestion charge levied downtown becomes a general tax increase if levied
 * everywhere and loses its point.
 *
 * A policy has one scope, and **both sides refuse**: refusing on one leaves the other settable,
 * doubling the effect silently while charging the fee once.
 *
 * A complete `Record` rather than a `Partial`, so a new `PolicyType` without a scope fails type
 * checking.
 */
export const POLICY_SCOPE: Record<PolicyType, PolicyScopeKind> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'district',
  [PolicyType.HIGH_DENSITY_BAN]: 'district',
  [PolicyType.ENCOURAGE_RECYCLING]: 'district',
  [PolicyType.ORGANIC_FOOD]: 'district',
  [PolicyType.TOURISM]: 'district',
  // The grid's total demand is a city-level pool: conservation required in half the city still
  // feeds the same grid.
  [PolicyType.ENERGY_REGULATION]: 'city',
  // These five all answer "where": which district gets the nightlife, which is preserved, which
  // stretch of industry is subsidised. City-wide, there is no siting left.
  [PolicyType.LEGALIZE_GAMBLING]: 'district',
  [PolicyType.NIGHT_ECONOMY]: 'district',
  [PolicyType.CURFEW]: 'district',
  [PolicyType.HERITAGE_PRESERVATION]: 'district',
  [PolicyType.INDUSTRY_SUBSIDY]: 'district',
  // These two answer "whether, and how hard": which streets get cameras is not the player's
  // decision, and refuse charges are not levied on one district. City-wide is never worse, so
  // city-wide it is.
  [PolicyType.SURVEILLANCE_NETWORK]: 'city',
  [PolicyType.PAY_AS_YOU_THROW]: 'city',
  [PolicyType.WATER_CONSERVATION]: 'city',
  [PolicyType.SEWAGE_STANDARDS]: 'city',
  // The source is per industrial cell and both benefit and cost land on industrial cells, so
  // which stretch of factories is regulated is a real decision; city-wide it only docks revenue
  // from industrial districts with no pollution problem.
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: 'district',
  // Fertility is one city-wide number. Subsidising one district reduces the decision to drawing
  // it over the densest housing, which is finding the largest patch rather than a trade-off.
  [PolicyType.CHILDCARE_SUBSIDY]: 'city',
  // How far compulsory schooling reaches is a law, not a property of a plot of land. Compulsory
  // to university in one district reduces the decision to drawing it beside the schools.
  [PolicyType.COMPULSORY_EDUCATION]: 'city',
  // Both answer "whether, and how hard" rather than "where". A district scope would also void
  // the cost: a smoking ban over purely residential land is free health, because there is no
  // commerce there to pay for it.
  [PolicyType.FREE_CLINIC]: 'city',
  [PolicyType.SMOKING_BAN]: 'city',
  // A congestion charge levied downtown becomes a general tax increase if levied everywhere, and
  // there is no charging zone left.
  [PolicyType.CONGESTION_CHARGE]: 'district',
};

/** Whether this policy means anything on a district. */
export function isDistrictScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'district';
}

/** Whether this policy is city-wide. */
export function isCityScoped(type: PolicyType): boolean {
  return POLICY_SCOPE[type] === 'city';
}

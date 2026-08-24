import { PolicyType } from './types';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, maxLevel } from './PolicyManager';
import { isDistrictScoped, POLICY_SCOPE, type PolicyScopeKind } from './PolicyScope';
import { policyCost, type PolicyScale } from './PolicyBilling';

/**
 * The pure logic behind the policy UI.
 *
 * The Solid layer is bound to `getGame()` and the project's convention is not to test UI, but how
 * far one press advances the level and what the button says are rules that really can be wrong
 * and should not rest on inspection alone. In core, they can be tested.
 */

/**
 * One press advances one level, and pressing past the top returns to 0.
 *
 * One button walks every level, with no need for three. `current` can come from a save and exceed
 * the current table's length, and must still be able to return to 0 or the button jams.
 */
export function nextPolicyLevel(current: number, type: PolicyType): number {
  const max = maxLevel(type);
  if (current >= max) return 0;
  return Math.max(0, Math.floor(current)) + 1;
}

/**
 * The button's text: dots for the level, an amount for **this period's** cost.
 *
 * The cost is on the button rather than in a help page because it moves with scale: drawing the
 * district twice as large doubles the number, the most direct feedback that billing follows
 * scale.
 *
 * Restrictive policies show no amount: their cost is an opportunity cost, and a $0 would read as
 * a free benefit.
 */
export function policyButtonText(type: PolicyType, level: number, scale: PolicyScale): string {
  const name = POLICY_CONFIG[type]?.name ?? type;
  if (level <= 0) return name;
  const dots = '●'.repeat(level);
  const cost = policyCost(type, level, scale);
  return cost > 0
    ? `✓${dots} ${name} ($${Math.round(cost)})`
    : `✓${dots} ${name}`;
}

/**
 * One line per level saying what it gives and what it costs.
 *
 * Benefit and cost on the same line rather than in a tooltip: the trade-off is the gameplay, and
 * hidden there is no trade-off. The player has to see the cost before pressing.
 */
const EFFECT_SUMMARY: Partial<Record<PolicyType, readonly string[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    'Garbage \u221215%  \u00B7  Commercial revenue \u22122%',
    'Garbage \u221235%  \u00B7  Commercial revenue \u22128%',
    'Garbage \u221255%  \u00B7  Commercial revenue \u221218%',
  ],
  [PolicyType.TOURISM]: ['Revenue +20%  \u00B7  Crime rises'],
  [PolicyType.ORGANIC_FOOD]: ['Land value +6  \u00B7  Commercial revenue \u22125%'],
  [PolicyType.ENERGY_REGULATION]: [
    'Power demand \u22128%  \u00B7  Commercial revenue \u22121%, industrial \u22122%',
    'Power demand \u221218%  \u00B7  Commercial revenue \u22123%, industrial \u22126%',
    'Power demand \u221230%  \u00B7  Commercial revenue \u22126%, industrial \u221212%',
  ],
  [PolicyType.NO_HEAVY_INDUSTRY]: ['No industry here  \u00B7  Gives up the industrial tax base'],
  [PolicyType.HIGH_DENSITY_BAN]: ['No high density here  \u00B7  Gives up the high-density tax base'],
  [PolicyType.LEGALIZE_GAMBLING]: ['Commercial revenue +35%  \u00B7  Crime +12'],
  [PolicyType.NIGHT_ECONOMY]: [
    'Commercial revenue +12%  \u00B7  Crime +4',
    'Commercial revenue +25%  \u00B7  Crime +10',
  ],
  [PolicyType.CURFEW]: [
    'Crime \u22125  \u00B7  Commercial revenue \u221210%',
    'Crime \u221210  \u00B7  Commercial revenue \u221222%',
  ],
  [PolicyType.HERITAGE_PRESERVATION]: [
    'Land value +12  \u00B7  Commercial revenue \u22128%, housing \u22126%',
  ],
  [PolicyType.INDUSTRY_SUBSIDY]: [
    'Industrial revenue +12%  \u00B7  Land value \u22124',
    'Industrial revenue +25%  \u00B7  Land value \u22129',
  ],
  [PolicyType.SURVEILLANCE_NETWORK]: [
    'Crime \u22126  \u00B7  Land value \u22122',
    'Crime \u221213  \u00B7  Land value \u22125',
  ],
  [PolicyType.PAY_AS_YOU_THROW]: [
    'Garbage \u221222%  \u00B7  Land value \u22123',
    'Garbage \u221242%  \u00B7  Land value \u22127',
  ],
  [PolicyType.WATER_CONSERVATION]: [
    'Water demand \u22128%  \u00B7  Commercial revenue \u22121%, industrial \u22122%',
    'Water demand \u221218%  \u00B7  Commercial revenue \u22123%, industrial \u22126%',
    'Water demand \u221230%  \u00B7  Commercial revenue \u22126%, industrial \u221212%',
  ],
  [PolicyType.SEWAGE_STANDARDS]: [
    'Sewage \u221215%  \u00B7  Industrial revenue \u22124%',
    'Sewage \u221230%  \u00B7  Industrial revenue \u221210%',
  ],
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    'Industrial ground pollution \u221220%  \u00B7  Industrial revenue \u22125%',
    'Industrial ground pollution \u221240%  \u00B7  Industrial revenue \u221212%',
    'Industrial ground pollution \u221260%  \u00B7  Industrial revenue \u221222%',
  ],
  [PolicyType.CHILDCARE_SUBSIDY]: [
    'Paid for infants  \u00B7  Births +20%  \u00B7  Business revenue \u22122%',
    'Paid through childhood  \u00B7  Births +45%  \u00B7  Business revenue \u22125%',
    'Paid through the teens  \u00B7  Births +70%  \u00B7  Business revenue \u22129%',
  ],
  [PolicyType.COMPULSORY_EDUCATION]: [
    'Schooling compulsory through elementary  \u00B7  Industrial revenue \u22123%',
    'Compulsory through high school  \u00B7  Industrial revenue \u22127%',
    'Compulsory through university  \u00B7  Industrial revenue \u221214%',
  ],
  [PolicyType.FREE_CLINIC]: [
    'Deaths \u221212% where hospitals reach  \u00B7  Commercial revenue \u22122%',
    'Deaths \u221225% where hospitals reach  \u00B7  Commercial revenue \u22125%',
  ],
  [PolicyType.SMOKING_BAN]: [
    'Deaths \u22126% citywide  \u00B7  Commercial revenue \u221212%',
  ],
  [PolicyType.CONGESTION_CHARGE]: [
    'Driving here costs 30% more  \u00B7  Commercial revenue \u22125%',
    'Driving here costs 75% more  \u00B7  Commercial revenue \u221212%',
  ],
};

/** What this policy does at this level. Level 0 returns an empty string. */
export function policyEffectSummary(type: PolicyType, level: number): string {
  if (level <= 0) return '';
  return EFFECT_SUMMARY[type]?.[level - 1] ?? '';
}

/**
 * The text on a strength button.
 *
 * Whole words rather than L/M/H: an abbreviation needs a hover to read, and two symbols for
 * single-level policies alongside three letters for three-level ones would put two languages in
 * one panel.
 *
 * A single-level policy says "On" rather than "Light": there is nothing heavier to switch to, and
 * "Light" leaves the player looking for a next step that does not exist.
 */
const TIER_NAMES = ['Light', 'Medium', 'Heavy'] as const;

/**
 * What this level is called. Shared by the strength button and the ledger's line items: written
 * separately, one policy would read "Medium" in the panel and "●●○" in the ledger, leaving the
 * player to guess which step those two dots meant.
 */
export function policyLevelLabel(type: PolicyType, level: number): string {
  if (!(level >= 1)) return 'Off';          // NaN takes this branch too
  if (maxLevel(type) <= 1) return 'On';
  // Saves are editable. Clamped rather than returning undefined, which would print
  // "undefined" in the ledger.
  const i = Math.min(Math.floor(level), TIER_NAMES.length) - 1;
  return TIER_NAMES[i]!;
}

/** The total cost of one district's policies this period. */
export function districtPolicyTotal(
  policies: readonly { type: PolicyType; level: number }[],
  scale: PolicyScale,
): number {
  let total = 0;
  for (const p of policies) total += policyCost(p.type, p.level, scale);
  return total;
}

/**
 * Which policies the district panel offers.
 *
 * City ordinances are filtered out: listed, the player presses them and nothing happens because
 * `setPolicyLevel` refuses, which is worse than not seeing them. This list lived in
 * `DistrictModal` and moved here to be testable: there, removing the filter turned no test red.
 */
export function districtOfferedPolicies(): PolicyType[] {
  return [...IMPLEMENTED_POLICY_TYPES].filter(isDistrictScoped);
}

/**
 * The policy categories.
 *
 * Sixteen policies in one row leave the player unable to find anything, and unable to see which
 * ones answer the same question. The categories say what a policy governs: what gets built where,
 * where the money comes from, how safe the night is, what gets discharged.
 *
 * `Retired` is not in this table: it is not a subject but the state of a policy that no longer
 * has an effect, reachable only from an older save.
 */
export const POLICY_CATEGORY: Record<PolicyType, string> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'Land use',
  [PolicyType.HIGH_DENSITY_BAN]: 'Land use',
  [PolicyType.HERITAGE_PRESERVATION]: 'Land use',

  [PolicyType.TOURISM]: 'Economy',
  [PolicyType.ORGANIC_FOOD]: 'Economy',
  [PolicyType.LEGALIZE_GAMBLING]: 'Economy',
  [PolicyType.NIGHT_ECONOMY]: 'Economy',
  [PolicyType.INDUSTRY_SUBSIDY]: 'Economy',

  [PolicyType.CURFEW]: 'Safety',
  [PolicyType.SURVEILLANCE_NETWORK]: 'Safety',

  [PolicyType.ENCOURAGE_RECYCLING]: 'Environment',
  [PolicyType.PAY_AS_YOU_THROW]: 'Environment',
  [PolicyType.ENERGY_REGULATION]: 'Environment',
  [PolicyType.WATER_CONSERVATION]: 'Environment',
  [PolicyType.SEWAGE_STANDARDS]: 'Environment',
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: 'Environment',

  [PolicyType.CHILDCARE_SUBSIDY]: 'Welfare',
  [PolicyType.COMPULSORY_EDUCATION]: 'Welfare',
  [PolicyType.FREE_CLINIC]: 'Welfare',
  [PolicyType.SMOKING_BAN]: 'Welfare',

  [PolicyType.CONGESTION_CHARGE]: 'Transport',
};

/** The order categories appear in the panel. */
export const CATEGORY_ORDER =
  ['Land use', 'Economy', 'Transport', 'Safety', 'Welfare', 'Environment'] as const;

/** Retired policies are collected in this group. */
export const RETIRED_CATEGORY = 'Retired';

export interface PolicyGroup {
  category: string;
  policies: PolicyType[];
}

/**
 * The policies one scope's panel shows, grouped by category.
 *
 * `alsoCarried` is what this district's save already holds: without it, a retired policy in an
 * older save disappears from the screen and the player can never switch it off. Retired ones are
 * collected in the `Retired` group, apart from those still in effect.
 *
 * Empty categories do not appear. The city panel has no Land use and no Economy, because what
 * gets built where and which district is subsidised are district questions.
 */
export function policiesByCategory(
  scope: PolicyScopeKind,
  alsoCarried: readonly PolicyType[] = [],
): PolicyGroup[] {
  const offered = [...IMPLEMENTED_POLICY_TYPES]
    .filter(t => POLICY_SCOPE[t] === scope);
  const offeredSet = new Set(offered);

  const byCategory = new Map<string, PolicyType[]>();
  for (const t of offered) {
    const c = POLICY_CATEGORY[t];
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(t);
  }

  const retired: PolicyType[] = [];
  for (const t of alsoCarried) {
    if (offeredSet.has(t)) continue;
    if (retired.includes(t)) continue;
    retired.push(t);
  }

  const groups: PolicyGroup[] = [];
  for (const c of CATEGORY_ORDER) {
    const policies = byCategory.get(c);
    if (policies?.length) groups.push({ category: c, policies });
  }
  if (retired.length) groups.push({ category: RETIRED_CATEGORY, policies: retired });
  return groups;
}

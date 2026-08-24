import { PolicyType } from './types';

/**
 * Exclusive groups: at most one policy from a group can be in effect.
 *
 * Gambling, the night economy and a curfew are three answers to one decision — whether this
 * district's nights are open, half open, or closed. All three at once is meaningless and purely
 * profitable when stacked: gambling on top of the night economy is +68.75% commercial revenue,
 * and part of the extra crime can then be bought back with a curfew.
 *
 * Groups rather than pairwise exclusions, because which policies conflict grows with the
 * catalogue, a pairwise table grows quadratically, and a missing pair has no symptom.
 */
const EXCLUSIVE_GROUPS: readonly (readonly PolicyType[])[] = [
  [PolicyType.LEGALIZE_GAMBLING, PolicyType.NIGHT_ECONOMY, PolicyType.CURFEW],
];

/** Policy to group index. Policies in no group are absent from this table. */
export const EXCLUSIVE_GROUP_OF: ReadonlyMap<PolicyType, number> = new Map(
  EXCLUSIVE_GROUPS.flatMap((g, i) => g.map(t => [t, i] as const)),
);

/** The other policies in the same group, or an empty array when there is no group. */
export function conflictsWith(type: PolicyType): readonly PolicyType[] {
  const group = EXCLUSIVE_GROUPS.find(g => g.includes(type));
  return group ? group.filter(t => t !== type) : [];
}

/**
 * This policy's position within its group, or -1 when it has none.
 *
 * Loading a save uses it to decide which policy survives a conflict within a group. The save
 * array's order will not do: one hand-edited file reordered would read differently, leaving the
 * player no way to know what happened.
 */
export function exclusiveGroupRank(type: PolicyType): number {
  const group = EXCLUSIVE_GROUPS.find(g => g.includes(type));
  return group ? group.indexOf(type) : -1;
}

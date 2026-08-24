import { EducationLevel } from './types';

/**
 * How much a citizen weighs walking time.
 *
 * Comparing speeds alone cannot express willingness to walk: in the model a cell of driving and a
 * cell of walking both cost one unit of time, so walking a cell to a stop costs the same as
 * driving it and walking carries no extra weight at all.
 *
 * The difference comes from education. The game has no separate income field — income is derived
 * from education (see `EDUCATION_SALARY_MULTIPLIERS`) — so that one axis carries both knowledge
 * and income.
 *
 * **Below 1 is deliberate, not a mistake.** Transport engineering's mode choice models weight
 * walking time at 1.5-2x, because for most people walking costs more than the time it takes. Here
 * university graduates sit at 0.8: people with higher education care about health and the
 * environment and would rather walk, even when it is slower. The ladder therefore crosses 1.0 —
 * tolerating and choosing are two different attitudes, and building a university pushes citizens
 * from the first towards the second, which is where this connects the education system to the
 * transport system.
 *
 * Measured with a 30-cell ride and a headway of 12, in cells walkable at each end while still
 * choosing the metro:
 *
 *   weight 2.0 walks 2 cells with no congestion, and the full distance only under heavy
 *   congestion
 *   weight 1.2 walks 5 cells with no congestion
 *   weight 0.8 walks the full 8 cells with no congestion
 *
 * 0.8 is already at the ceiling: 8 cells is the metro's hard limit, so 0.8, 0.6 and 0.4 behave
 * identically. Going further means changing `WalkRange`'s limit rather than this.
 *
 * The weight is used for **comparison** alone: citizens decide how to travel with weighted time,
 * while commute statistics and the job-change threshold use the time actually spent. Mixing the
 * two puts a number nobody actually spent on the commute time overlay.
 */
export const WALK_DISUTILITY = {
  BY_EDUCATION: {
    [EducationLevel.NONE]: 2.0,
    [EducationLevel.ELEMENTARY]: 1.6,
    [EducationLevel.HIGH_SCHOOL]: 1.2,
    [EducationLevel.UNIVERSITY]: 0.8,
  } as Record<EducationLevel, number>,
  /**
   * The average used when no citizen is named.
   *
   * Two uses: older saves may have no education field, and city-wide commute statistics are a
   * distribution, where any one citizen's disposition is the wrong one. The middle of the ladder.
   */
  FALLBACK: 1.4,
} as const;

/** How much this citizen multiplies walking time by. */
export function walkWeightOf(education: EducationLevel): number {
  return WALK_DISUTILITY.BY_EDUCATION[education] ?? WALK_DISUTILITY.FALLBACK;
}

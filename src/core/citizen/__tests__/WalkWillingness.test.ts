import { describe, it, expect } from 'vitest';
import { WALK_DISUTILITY, walkWeightOf } from '../WalkWillingness';
import { EducationLevel } from '../types';

/**
 * A minute walking is harder than a minute sitting.
 *
 * Comparing speeds alone cannot express that: in the model a cell of driving and a cell of
 * walking both cost one unit of time, so walking a cell to a stop costs the same as driving it
 * and walking carries no extra reluctance. Real mode choice models weight walking time at 1.5-2x,
 * because walking costs more than the time it takes.
 *
 * Willingness to walk varies: people with more education care more about health and the
 * environment and are less inclined to take driving as a given. The game has no separate income
 * field — income is derived from education (`EDUCATION_SALARY_MULTIPLIERS`) — so that one axis
 * carries both knowledge and income.
 */

describe('步行的不情願權重', () => {
  it('should make walking feel longer than it takes for most people', () => {
    // Transport engineering's convention: for most people walking costs more than the time it
    // takes.
    expect(walkWeightOf(EducationLevel.NONE)).toBeGreaterThan(1);
    expect(walkWeightOf(EducationLevel.ELEMENTARY)).toBeGreaterThan(1);
    expect(walkWeightOf(EducationLevel.HIGH_SCHOOL)).toBeGreaterThan(1);
  });

  it('should make a graduate actively prefer walking', () => {
    // Below 1 is deliberate: people with higher education care about health and the environment
    // and would rather walk, even when it is slower. The ladder therefore crosses 1.0 —
    // tolerating and choosing are two different attitudes, and building a university pushes
    // citizens from the first towards the second.
    expect(
      walkWeightOf(EducationLevel.UNIVERSITY),
      '大學畢業者只是比較能忍，還不到主動選擇走路',
    ).toBeLessThan(1);
  });

  it('should make the educated more willing to walk', () => {
    expect(walkWeightOf(EducationLevel.UNIVERSITY))
      .toBeLessThan(walkWeightOf(EducationLevel.HIGH_SCHOOL));
    expect(walkWeightOf(EducationLevel.HIGH_SCHOOL))
      .toBeLessThan(walkWeightOf(EducationLevel.ELEMENTARY));
    expect(walkWeightOf(EducationLevel.ELEMENTARY))
      .toBeLessThan(walkWeightOf(EducationLevel.NONE));
  });

  it('should stay within a band where the number still does something', () => {
    // The upper bound of 3: above it nobody walks to a stop and transit stops working entirely.
    // The lower bound of 0.8: at 0.8 the full 8-cell metro limit is walked even with no
    // congestion, and lower behaves identically — not a stronger setting, just a number that
    // looks different.
    for (const level of Object.values(EducationLevel)) {
      expect(walkWeightOf(level), `${level} 的權重超出有意義的範圍`)
        .toBeLessThanOrEqual(3);
      expect(walkWeightOf(level), `${level} 的權重低到再調也沒有差別`)
        .toBeGreaterThanOrEqual(0.8);
    }
  });

  it('should fall back for a citizen with no education recorded', () => {
    // Older saves may not have this field.
    expect(walkWeightOf(undefined as unknown as EducationLevel))
      .toBe(WALK_DISUTILITY.FALLBACK);
  });
});

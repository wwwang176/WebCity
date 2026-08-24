import { EducationLevel } from './types';

/**
 * An index of how many people live in and work at each building.
 *
 * Service load — police, fire, hospitals, schools — is demand **per cell**, and residents of one
 * building produce identical results, because coordinates, coverage, pollution and district all
 * depend only on the building. Each service scanned the citizen list itself, paying two
 * `parsePosKey` calls, two `getCoverage` calls and one `getCell` per citizen and pushing a small
 * object onto an array. In a city of 120,000, police and fire alone allocated around 240,000
 * objects across a few thousand distinct positions: 12,434 people measured living in 103
 * buildings.
 *
 * Counting people per cell first drops the expensive lookups from O(population) to O(buildings),
 * leaving one Map increment per citizen.
 *
 * This is **not** an approximation: downstream, `distributeLoadToNearest`,
 * `SchoolService.updateLoads` and `HealthService.updateLoads` only sum entries for one cell, so
 * pre-summing gives the same result.
 */
export interface CitizenLocationIndex {
  /** `homeId` to how many people live there. */
  readonly homeCounts: ReadonlyMap<string, number>;
  /** `homeId` to a count per education level. Only police demand weights follow education. */
  readonly homeEducation: ReadonlyMap<string, ReadonlyMap<EducationLevel, number>>;
  /** `workplaceId` to how many people work there. */
  readonly workCounts: ReadonlyMap<string, number>;
}

interface CitizenLike {
  homeId: string | null;
  workplaceId: string | null;
  education: EducationLevel;
}

/**
 * Walks the citizen list once and counts the people per cell.
 *
 * The pass is O(population), but each citizen costs one Map increment: no string parsing, no cell
 * lookups, no allocation. Four services share the result in place of a pass each.
 */
export function buildCitizenLocationIndex(
  citizens: readonly CitizenLike[],
): CitizenLocationIndex {
  const homeCounts = new Map<string, number>();
  const homeEducation = new Map<string, Map<EducationLevel, number>>();
  const workCounts = new Map<string, number>();

  for (const c of citizens) {
    const home = c.homeId;
    if (home !== null) {
      homeCounts.set(home, (homeCounts.get(home) ?? 0) + 1);
      let byEdu = homeEducation.get(home);
      if (byEdu === undefined) {
        byEdu = new Map();
        homeEducation.set(home, byEdu);
      }
      byEdu.set(c.education, (byEdu.get(c.education) ?? 0) + 1);
    }
    const work = c.workplaceId;
    if (work !== null) {
      workCounts.set(work, (workCounts.get(work) ?? 0) + 1);
    }
  }

  return { homeCounts, homeEducation, workCounts };
}

import { isWorkingAge, LIFE_STAGE_AGE } from './types';

/**
 * How a citizen is described in the panels.
 *
 * In core rather than in the panels because two places say the same thing — the building panel's
 * resident list and the citizen detail panel — and both have to agree with **the overview's
 * statistics**.
 */

/**
 * What the "Work" row says.
 *
 * With a job, where they work. Without one, "unemployed" applies only to people of **working
 * age**:
 *
 * - Both overview pages count only `isWorkingAge` / `lifeStage === ADULT` citizens, while the
 *   panel printed Unemployed for anyone with `workplaceId === null`. So a city reading "Full
 *   employment, 662 vacancies" opened onto housing full of Unemployed: the figures were right
 *   and the word was wrong.
 * - The old are **retired**, not unemployed. Children and students are **not yet of age**, and
 *   are not either.
 */
export function citizenWorkLabel(citizen: {
  age: number;
  workplaceId: string | null;
  educationProgress: number;
}): string {
  if (citizen.workplaceId !== null) return citizen.workplaceId;
  if (citizen.age > LIFE_STAGE_AGE.ADULT_MAX) return 'Retired';
  if (isWorkingAge(citizen.age)) return 'Unemployed';
  return citizen.educationProgress > 0 ? 'Student' : 'Too young to work';
}

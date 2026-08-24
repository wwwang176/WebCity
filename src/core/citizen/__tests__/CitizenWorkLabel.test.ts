import { describe, it, expect } from 'vitest';
import { citizenWorkLabel } from '../CitizenPresentation';
import { isWorkingAge, LIFE_STAGE_AGE, MAX_AGE } from '../types';

/**
 * The panel's "Unemployed" has to mean what the overview counts.
 *
 * Both overview pages count only people of **working age** (`isWorkingAge` /
 * `lifeStage === ADULT`), while the panel printed Unemployed for anyone with
 * `workplaceId === null` — children, students and the retired all counted as unemployed. So a
 * city reading "Full employment, 662 vacancies" opened onto housing full of Unemployed. The
 * figures were right and the word was wrong.
 */

const at = (age: number, over: Partial<{ workplaceId: string | null; educationProgress: number }> = {}) =>
  ({ age, workplaceId: null, educationProgress: 0, ...over });

describe('citizenWorkLabel', () => {
  it('should show where they work when they have a job', () => {
    expect(citizenWorkLabel(at(100, { workplaceId: '12,34' }))).toBe('12,34');
  });

  it('should call a jobless adult unemployed', () => {
    expect(citizenWorkLabel(at(100))).toBe('Unemployed');
  });

  it('should call a pensioner retired, not unemployed', () => {
    expect(citizenWorkLabel(at(LIFE_STAGE_AGE.ADULT_MAX + 1))).toBe('Retired');
    expect(citizenWorkLabel(at(MAX_AGE - 1))).toBe('Retired');
  });

  it('should call an enrolled child a student', () => {
    expect(citizenWorkLabel(at(20, { educationProgress: 5 }))).toBe('Student');
    expect(citizenWorkLabel(at(40, { educationProgress: 1 }))).toBe('Student');
  });

  it('should not call a toddler unemployed either', () => {
    expect(citizenWorkLabel(at(2))).toBe('Too young to work');
    expect(citizenWorkLabel(at(20))).toBe('Too young to work');
  });

  it('should say Unemployed exactly when the overview counts one', () => {
    // The point of the test: the panel and the overview have to say the same thing about the
    // same people. The overview counts `isWorkingAge(age) && workplaceId === null`.
    for (let age = 0; age <= MAX_AGE; age++) {
      const label = citizenWorkLabel(at(age));
      const counted = isWorkingAge(age);
      expect(label === 'Unemployed', `age=${age}`).toBe(counted);
    }
  });

  it('should never say Unemployed about someone who has a job', () => {
    for (let age = 0; age <= MAX_AGE; age += 7) {
      expect(citizenWorkLabel(at(age, { workplaceId: '1,1' }))).toBe('1,1');
    }
  });
});

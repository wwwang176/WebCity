import { EducationLevel, LifeStage, type Citizen } from '../../src/core/citizen/types';

/**
 * A complete, current-shape citizen.
 *
 * Suites that hand-rolled one drifted badly — `ServiceCoverageIntegration`
 * still built `{ id: 'test_1', educationLevel: 'none', income: 100, x: 5, y: 5 }`
 * from a shape with none of those fields and none of the nine it does have.
 * Passing such an object means every field the code under test reads is
 * `undefined`, which in arithmetic becomes NaN and in a comparison becomes
 * false — so the case measures the fixture's decay, not the behaviour.
 */
export function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    happiness: 50,
    health: 100,
    homeId: '5,5',
    workplaceId: '6,6',
    unemployedSince: null,
    homelessSince: null,
    emigrationTolerance: 25,
    educationProgress: 0,
    ...overrides,
  };
}

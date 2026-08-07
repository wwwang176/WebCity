import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { LIFE_STAGE_AGE, isWorkingAge, AGE_PER_TICK } from '../types';

function makeManager(): CitizenManager {
  return new CitizenManager();
}

describe('evictBuilding records unemployment', () => {
  it('should set unemployedSince when a workplace is demolished', () => {
    // Happiness escalates the unemployment penalty by duration:
    // -15 immediately, -25 after 30 ticks, -100 when forced. The escalation
    // reads unemployedSince, and Happiness early-returns the first tier when it
    // is null — so demolition-driven unemployment was frozen at the mildest
    // penalty forever. The three other unemployment paths (JobRelocation x2,
    // SimulationLoop unreachable-workplace) all record it; this one did not,
    // and evictBuilding already recorded the symmetric homelessSince.
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.homeId = '1,1';
    c.workplaceId = '5,5';
    c.unemployedSince = null;

    cm.evictBuilding('5,5', 500);

    expect(c.workplaceId).toBeNull();
    expect(c.unemployedSince).toBe(500);
  });

  it('should still record homelessSince when a home is demolished', () => {
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.homeId = '1,1';

    cm.evictBuilding('1,1', 500);

    expect(c.homeId).toBeNull();
    expect(c.homelessSince).toBe(500);
  });

  it('should not touch unemployedSince for a citizen who kept their job', () => {
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.homeId = '1,1';
    c.workplaceId = '5,5';
    c.unemployedSince = null;

    cm.evictBuilding('1,1', 500);

    expect(c.workplaceId).toBe('5,5');
    expect(c.unemployedSince).toBeNull();
  });
});

describe('citizens retire when they age out of working age', () => {
  it('should release the job of a citizen who crosses ADULT_MAX', () => {
    // Nothing in the codebase ever cleared workplaceId by age. Job assignment
    // filters to working-age citizens, but workOccupancy counts every citizen
    // with a workplaceId, so retirees permanently held posts that could never
    // be reassigned — and they are invisible in unemploymentRate, which only
    // counts working-age citizens.
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.workplaceId = '5,5';

    // Park the citizen just past the end of working age.
    const tick = Math.ceil((LIFE_STAGE_AGE.ADULT_MAX + 1) / AGE_PER_TICK);
    cm.updateAges(tick);

    expect(isWorkingAge(c.age)).toBe(false);
    expect(c.workplaceId).toBeNull();
  });

  it('should not mark a retiree as unemployed', () => {
    // Retirement is not unemployment: an unemployedSince stamp would apply the
    // happiness penalty ladder to every senior in the city.
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.workplaceId = '5,5';

    cm.updateAges(Math.ceil((LIFE_STAGE_AGE.ADULT_MAX + 1) / AGE_PER_TICK));

    expect(c.unemployedSince).toBeNull();
  });

  it('should leave a working-age citizen employed', () => {
    const cm = makeManager();
    const c = cm.createCitizen({ birthTick: 0 }, 0)!;
    c.workplaceId = '5,5';

    const tick = Math.floor((LIFE_STAGE_AGE.TEEN_MAX + 10) / AGE_PER_TICK);
    cm.updateAges(tick);

    expect(isWorkingAge(c.age)).toBe(true);
    expect(c.workplaceId).toBe('5,5');
  });
});

import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { birthTick } from '../Birth';
import { EDUCATION_THRESHOLDS } from '../Migration';
import { calculateCitizenHealth, HEALTH } from '../CitizenHealth';
import { LAND_VALUE, calculateLandValue } from '../../economy/LandValue';

describe('birthTick respects the building it is filling', () => {
  it('should not push a home past its resident capacity', () => {
    // getMaxChildren only caps BABY+CHILD; nothing compared total occupancy with
    // capacity, and the only other gate is the CITY-WIDE housing total. So a
    // 4-resident house already holding 4 adults could still gain 2 children
    // whenever anywhere else in the city had a spare home (BUG-082).
    const cm = new CitizenManager();
    const CAPACITY = 4;
    for (let i = 0; i < CAPACITY; i++) {
      const c = cm.createCitizen({ age: 100, birthTick: 0 })!;
      c.homeId = '5,5';
      c.happiness = 100;
    }

    // Fertility forced to 1 so the only thing that can stop a birth is the cap.
    birthTick(cm, { baseFertilityRate: 1, happinessBonus: 0, getResidents: () => CAPACITY }, 0);

    expect(cm.getCitizens().filter(c => c.homeId === '5,5').length).toBeLessThanOrEqual(CAPACITY);
  });

  it('should still allow births when the home has room', () => {
    const cm = new CitizenManager();
    for (let i = 0; i < 2; i++) {
      const c = cm.createCitizen({ age: 100, birthTick: 0 })!;
      c.homeId = '5,5';
      c.happiness = 100;
    }

    const births = birthTick(cm, { baseFertilityRate: 1, happinessBonus: 0, getResidents: () => 8 }, 0);

    expect(births).toBeGreaterThan(0);
  });
});

describe('health pollution penalty is bounded by its own constant', () => {
  it('should never exceed POLLUTION_MAX_PENALTY', () => {
    // The divisor was 100 while the field is a 0-255 grid value, so the "max"
    // penalty was really a rate: 255 pollution cost 38.25, not 15 (BUG-083).
    const clean = calculateCitizenHealth({
      age: 100, hasHome: true, hospitalCostRatio: -1,
      hasParkCoverage: false, pollution: 0,
    });
    const filthy = calculateCitizenHealth({
      age: 100, hasHome: true, hospitalCostRatio: -1,
      hasParkCoverage: false, pollution: 255,
    });

    expect(clean - filthy).toBeLessThanOrEqual(HEALTH.POLLUTION_MAX_PENALTY + 1e-9);
  });

  it('should still scale between clean and dirty', () => {
    const mid = calculateCitizenHealth({
      age: 100, hasHome: true, hospitalCostRatio: -1,
      hasParkCoverage: false, pollution: 128,
    });
    const filthy = calculateCitizenHealth({
      age: 100, hasHome: true, hospitalCostRatio: -1,
      hasParkCoverage: false, pollution: 255,
    });

    expect(mid).toBeGreaterThan(filthy);
  });
});

describe('immigration tuning thresholds are reachable', () => {
  it('should set AVG_LAND_VALUE below the maximum calculateLandValue can produce', () => {
    // Every positive term at maximum: BASE 50 + serviceCoverage 10 x 4
    // + PARK 15 + WATERFRONT 20 = 125. A threshold of 150 made the
    // HIGH_LAND_VALUE immigration weighting dead code (BUG-084).
    const MAX_SERVICE_SCORE = 10; // power 2 + water 2 + six services at 1
    const maxAchievable = calculateLandValue({
      serviceCoverage: MAX_SERVICE_SCORE,
      parkProximity: true,
      waterfront: true,
      pollution: 0,
      noise: 0,
      crimeRate: 0,
    });

    expect(maxAchievable).toBeLessThan(LAND_VALUE.MAX);
    expect(EDUCATION_THRESHOLDS.AVG_LAND_VALUE).toBeLessThan(maxAchievable);
  });
});

import { describe, it, expect } from 'vitest';
import { calculateLandValue } from '../../economy/LandValue';
import { calculateHappiness, HAPPINESS } from '../../citizen/Happiness';
import type { Citizen } from '../../citizen/types';

describe('serviceCoverage integration with road-based services', () => {
  const baseCitizen: Citizen = {
    id: 'test_1',
    age: 30,
    happiness: 50,
    educationLevel: 'none',
    homeId: 'home_1',
    workplaceId: 'work_1',
    income: 100,
    x: 5,
    y: 5,
  };

  describe('Happiness thresholds with extended serviceCoverage', () => {
    it('serviceCoverage=7 (power+water+police+fire+garbage) gives +10 happiness', () => {
      const happiness = calculateHappiness(baseCitizen, {
        commuteDistance: 3,
        hasPark: false,
        pollution: 0,
        noiseLevel: 0,
        crimeRate: 0,
        isEmployed: true,
        taxRate: 10,
        serviceCoverage: 7, // power(2) + water(2) + police(1) + fire(1) + garbage(1)
      });
      // With threshold 6 → +10
      expect(happiness).toBeGreaterThanOrEqual(HAPPINESS.BASE + 10);
    });

    it('serviceCoverage=4 (power+water only) gives +5 happiness', () => {
      const happiness = calculateHappiness(baseCitizen, {
        commuteDistance: 3,
        hasPark: false,
        pollution: 0,
        noiseLevel: 0,
        crimeRate: 0,
        isEmployed: true,
        taxRate: 10,
        serviceCoverage: 4, // power(2) + water(2)
      });
      // With threshold 4 → +5
      expect(happiness).toBeGreaterThanOrEqual(HAPPINESS.BASE + 5);
    });

    it('serviceCoverage=3 (missing services) gives no service bonus', () => {
      const happiness = calculateHappiness(baseCitizen, {
        commuteDistance: 3,
        hasPark: false,
        pollution: 0,
        noiseLevel: 0,
        crimeRate: 0,
        isEmployed: true,
        taxRate: 10,
        serviceCoverage: 3,
      });
      // Below threshold 4 → no service bonus
      const baseHappiness = calculateHappiness(baseCitizen, {
        commuteDistance: 3,
        hasPark: false,
        pollution: 0,
        noiseLevel: 0,
        crimeRate: 0,
        isEmployed: true,
        taxRate: 10,
        serviceCoverage: 0,
      });
      expect(happiness).toBe(baseHappiness);
    });
  });

  describe('LandValue with extended serviceCoverage', () => {
    it('higher serviceCoverage yields higher land value', () => {
      const base = calculateLandValue({
        serviceCoverage: 4, // power + water only
        parkProximity: false,
        waterfront: false,
        pollution: 0,
        noise: 0,
        crimeRate: 0,
      });

      const withServices = calculateLandValue({
        serviceCoverage: 7, // + police, fire, garbage
        parkProximity: false,
        waterfront: false,
        pollution: 0,
        noise: 0,
        crimeRate: 0,
      });

      // Each extra coverage point adds SERVICE_MULTIPLIER (4)
      expect(withServices - base).toBe(3 * 4); // 3 extra services × 4
    });
  });
});

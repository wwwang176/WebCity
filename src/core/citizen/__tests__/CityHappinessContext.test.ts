import { describe, it, expect } from 'vitest';
import { calculateCityHappinessContext, calculateAvgCommute, calculateCityServiceCoverage } from '../CityHappinessContext';
import { SIMULATION } from '../../simulation/SimulationConstants';

describe('CityHappinessContext', () => {
  describe('calculateAvgCommute', () => {
    it('returns 3 when no residential buildings exist', () => {
      expect(calculateAvgCommute(0)).toBe(3);
    });

    it('increases with more residential buildings', () => {
      const low = calculateAvgCommute(10);
      const high = calculateAvgCommute(100);
      expect(high).toBeGreaterThan(low);
    });

    it('caps at COMMUTE_MAX', () => {
      const huge = calculateAvgCommute(100000);
      expect(huge).toBeLessThanOrEqual(SIMULATION.COMMUTE_MAX);
    });
  });

  describe('calculateCityServiceCoverage', () => {
    it('returns 0 when no services are active', () => {
      const ratios = {
        poweredRatio: 0, wateredRatio: 0,
        sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
        healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
      };
      expect(calculateCityServiceCoverage(ratios, 50)).toBe(0);
    });

    it('adds low pollution bonus when pollution is below threshold', () => {
      const ratios = {
        poweredRatio: 0, wateredRatio: 0,
        sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
        healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
      };
      const low = calculateCityServiceCoverage(ratios, 5);
      const high = calculateCityServiceCoverage(ratios, 50);
      expect(low).toBeGreaterThan(high);
    });

    it('weights power and water at 2x', () => {
      const ratios = {
        poweredRatio: 1, wateredRatio: 1,
        sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
        healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
      };
      expect(calculateCityServiceCoverage(ratios, 50)).toBe(4);
    });

    it('should count sewage like every other service', () => {
      // `sewageRatio` was declared on ServiceRatios and computed by
      // ServiceCoverageQuery, and then read by nobody — the weighted sum here
      // listed the other eight and skipped it. Building treatment plants did
      // nothing at all for city happiness, and the omission was invisible
      // because the fixtures below did not supply the field either.
      const none = {
        poweredRatio: 0, wateredRatio: 0, sewageRatio: 0,
        policeRatio: 0, fireRatio: 0, garbageRatio: 0,
        healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
      };
      expect(calculateCityServiceCoverage({ ...none, sewageRatio: 1 }, 50))
        .toBeGreaterThan(calculateCityServiceCoverage(none, 50));
    });

    it('should weight sewage the same as the other ordinary services', () => {
      // Power and water are the deliberate 2x exceptions; sewage is not one.
      const none = {
        poweredRatio: 0, wateredRatio: 0, sewageRatio: 0,
        policeRatio: 0, fireRatio: 0, garbageRatio: 0,
        healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
      };
      expect(calculateCityServiceCoverage({ ...none, sewageRatio: 1 }, 50))
        .toBe(calculateCityServiceCoverage({ ...none, policeRatio: 1 }, 50));
    });
  });

  describe('calculateCityHappinessContext', () => {
    it('calculates employment rate from jobs and adults', () => {
      const ctx = calculateCityHappinessContext({
        totalJobs: 50,
        adultCount: 100,
        avgPollution: 0,
        avgNoise: 0,
        avgCrime: 0,
        residentialBuildingCount: 10,
        serviceRatios: {
          poweredRatio: 0, wateredRatio: 0,
          sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
          healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
        },
      });
      expect(ctx.employmentRate).toBe(0.5);
    });

    it('caps employment rate at 1', () => {
      const ctx = calculateCityHappinessContext({
        totalJobs: 200,
        adultCount: 100,
        avgPollution: 0,
        avgNoise: 0,
        avgCrime: 0,
        residentialBuildingCount: 10,
        serviceRatios: {
          poweredRatio: 0, wateredRatio: 0,
          sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
          healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
        },
      });
      expect(ctx.employmentRate).toBe(1);
    });

    it('returns default employment rate of 1 when no adults', () => {
      const ctx = calculateCityHappinessContext({
        totalJobs: 0,
        adultCount: 0,
        avgPollution: 0,
        avgNoise: 0,
        avgCrime: 0,
        residentialBuildingCount: 0,
        serviceRatios: {
          poweredRatio: 0, wateredRatio: 0,
          sewageRatio: 0, policeRatio: 0, fireRatio: 0, garbageRatio: 0,
          healthRatio: 0, educationRatio: 0, deathCareRatio: 0,
        },
      });
      expect(ctx.employmentRate).toBe(1);
    });
  });
});

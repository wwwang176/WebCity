import { describe, it, expect } from 'vitest';
import { getAvgResidentialPollution, getAvgResidentialNoise, calculateCrimeRate } from '../CityMetrics';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { SIMULATION } from '../../simulation/SimulationLoop';

describe('CityMetrics', () => {
  describe('getAvgResidentialPollution', () => {
    it('returns 0 when no residential cells exist', () => {
      const grid = new Grid(5, 5);
      expect(getAvgResidentialPollution(grid)).toBe(0);
    });

    it('returns average pollution across residential cells only', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, pollution: 20 });
      grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_HIGH, pollution: 40 });
      grid.setCell(2, 0, { zoneType: ZoneType.INDUSTRIAL, pollution: 100 });
      // Average of 20 and 40 = 30, ignoring industrial
      expect(getAvgResidentialPollution(grid)).toBe(30);
    });

    it('ignores non-residential cells', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.COMMERCIAL_LOW, pollution: 50 });
      expect(getAvgResidentialPollution(grid)).toBe(0);
    });
  });

  describe('getAvgResidentialNoise', () => {
    it('returns 0 when no residential cells exist', () => {
      const grid = new Grid(5, 5);
      expect(getAvgResidentialNoise(grid)).toBe(0);
    });

    it('returns average noise across residential cells only', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, noiseLevel: 10 });
      grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, noiseLevel: 30 });
      expect(getAvgResidentialNoise(grid)).toBe(20);
    });
  });

  describe('calculateCrimeRate', () => {
    it('returns 0 when population is 0', () => {
      expect(calculateCrimeRate(0, 0)).toBe(0);
    });

    it('scales with population', () => {
      const low = calculateCrimeRate(100, 0);
      const high = calculateCrimeRate(500, 0);
      expect(high).toBeGreaterThan(low);
    });

    it('caps base crime at CRIME_BASE_MAX', () => {
      const huge = calculateCrimeRate(100000, 0);
      expect(huge).toBeLessThanOrEqual(SIMULATION.CRIME_BASE_MAX);
    });

    it('reduces crime with police stations', () => {
      const noCops = calculateCrimeRate(200, 0);
      const withCops = calculateCrimeRate(200, 3);
      expect(withCops).toBeLessThan(noCops);
    });

    it('police coverage caps at maximum reduction', () => {
      const manyCops = calculateCrimeRate(200, 100);
      const baseCrime = Math.min(SIMULATION.CRIME_BASE_MAX, 200 * SIMULATION.CRIME_POP_FACTOR);
      const minCrime = baseCrime * (1 - SIMULATION.CRIME_MAX_REDUCTION);
      expect(manyCops).toBeCloseTo(minCrime, 5);
    });
  });
});

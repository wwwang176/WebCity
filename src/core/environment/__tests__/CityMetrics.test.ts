import { describe, it, expect } from 'vitest';
import {
  getAvgResidentialPollution, calculateCrimeRate, avgResidentialMetric,
  effectiveCityCrime, rawCityCrime,
} from '../CityMetrics';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { SIMULATION } from '../../simulation/SimulationConstants';

describe('CityMetrics', () => {
  describe('getAvgResidentialPollution', () => {
    it('returns 0 when no residential cells exist', () => {
      const grid = new Grid(5, 5);
      expect(getAvgResidentialPollution(grid)).toBe(0);
    });

    it('returns average pollution across residential cells only', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 20 });
      grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 1, pollution: 40 });
      grid.setCell(2, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1, pollution: 100 });
      // Average of 20 and 40 = 30, ignoring industrial
      expect(getAvgResidentialPollution(grid)).toBe(30);
    });

    it('ignores non-residential cells', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 1, pollution: 50 });
      expect(getAvgResidentialPollution(grid)).toBe(0);
    });
  });

  // getAvgResidentialNoise was removed rather than tested.
  //
  // It read `cell.noiseLevel`, which only updateLandValue writes — every 60
  // ticks — while happiness and growth run every 6, so every building grown in
  // the last ten slow ticks reported a noise of 0. SimulationLoop.getAvgNoise
  // was rewritten to read the live pollution grid instead (BUG-121) and this
  // function was left behind with the old semantics and no caller. Keeping a
  // tested copy of the wrong answer is an invitation to call it.
  //
  // The behaviour that replaced it is covered by AvgNoiseIsLive.test.ts.

  describe('avgResidentialMetric (shared helper)', () => {
    it('works with arbitrary cell accessor', () => {
      const grid = new Grid(5, 5);
      grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, landValue: 50 });
      grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 1, landValue: 100 });
      grid.setCell(2, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1, landValue: 200 });
      // Average of 50 and 100 = 75, ignoring industrial
      expect(avgResidentialMetric(grid, cell => cell.landValue)).toBe(75);
    });

    it('returns 0 when no residential cells', () => {
      const grid = new Grid(3, 3);
      expect(avgResidentialMetric(grid, cell => cell.pollution)).toBe(0);
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


describe('全城的有效犯罪率', () => {
  it('should be the unpoliced base when there is not a single station', () => {
    expect(effectiveCityCrime(1000, 0, 0)).toBe(calculateCrimeRate(1000, 0));
  });

  it('should come down as stations go up', () => {
    // The counterexample to "no number of police stations moves it".
    const none = effectiveCityCrime(10_000, 0, 0);
    const some = effectiveCityCrime(10_000, 2, 0);
    const many = effectiveCityCrime(10_000, 7, 0);

    expect(some, '蓋了警局犯罪率沒動').toBeLessThan(none);
    expect(many, '蓋更多沒有更低').toBeLessThan(some);
  });

  it('should stop rewarding stations once coverage is full', () => {
    // Coverage clamps at 1, so the eighth station onwards adds nothing. Building down to 0
    // without limit would turn police stations into a pay-to-win button.
    expect(effectiveCityCrime(10_000, 20, 0)).toBe(effectiveCityCrime(10_000, 7, 0));
  });

  it('should add what the ordinances cost or save', () => {
    // Casinos add, the surveillance network subtracts. Without this term the panel reads
    // Crime -13 while residents feel nothing.
    const plain = effectiveCityCrime(10_000, 2, 0);

    expect(effectiveCityCrime(10_000, 2, 10)).toBe(plain + 10);
    expect(effectiveCityCrime(10_000, 2, -5)).toBe(plain - 5);
  });

  it('should never go below zero', () => {
    // A negative crime rate becomes a bonus downstream: `calculateLandValue` does
    // `value -= crimeRate * CRIME_PENALTY`, paying more the more layers are stacked.
    expect(effectiveCityCrime(10_000, 7, -1000)).toBe(0);
  });

  it('should clamp only after everything has been added', () => {
    // Clamping the first half turns a base of 1 plus -100 into 0, so +120 on top reads 120,
    // where clamping after everything gives 21. One cell would have two answers across the
    // two systems.
    expect(rawCityCrime(50, 0, -100) + 120).toBe(rawCityCrime(50, 0, 20));
  });
});

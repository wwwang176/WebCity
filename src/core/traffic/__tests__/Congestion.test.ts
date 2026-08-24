import { describe, it, expect } from 'vitest';
import { getCongestionRate, getSpeedMultiplier, CONGESTION } from '../Congestion';

/**
 * Congestion is derived from demand; see `RouteCongestion.ts` and its tests.
 *
 * `TrafficSimulation.getCongestionLevel` computed city-wide congestion from the vehicles on
 * screen and no longer exists: vehicle entities are capped in number and refused by the spawn
 * clearance check, making them a presentation of the simulation rather than the simulation
 * itself, and the figure pinned to its ceiling in any city of size (BUG-326).
 */

describe('Congestion', () => {
  it('should calculate congestion rate', () => {
    expect(getCongestionRate(8, 10)).toBeCloseTo(0.8);
    expect(getCongestionRate(12, 10)).toBeCloseTo(1.2);
  });

  it('should reduce speed at >80% congestion', () => {
    const multiplier = getSpeedMultiplier(0.85);
    expect(multiplier).toBe(0.5);
  });

  it('should nearly stop at >100% congestion', () => {
    const multiplier = getSpeedMultiplier(1.2);
    expect(multiplier).toBeLessThan(0.2);
  });

  it('should have full speed under 50% congestion', () => {
    expect(getSpeedMultiplier(0.3)).toBe(1);
  });

  it('should recover speed when congestion drops', () => {
    const high = getSpeedMultiplier(0.9);
    const low = getSpeedMultiplier(0.3);
    expect(low).toBeGreaterThan(high);
  });

  it('CONGESTION thresholds should be in ascending order', () => {
    expect(CONGESTION.LOW_THRESHOLD).toBeLessThan(CONGESTION.MEDIUM_THRESHOLD);
    expect(CONGESTION.MEDIUM_THRESHOLD).toBeLessThan(CONGESTION.HIGH_THRESHOLD);
  });

  it('CONGESTION speed multipliers should decrease with congestion', () => {
    expect(CONGESTION.MEDIUM_SPEED).toBeLessThan(1);
    expect(CONGESTION.HIGH_SPEED).toBeLessThan(CONGESTION.MEDIUM_SPEED);
    expect(CONGESTION.MIN_SPEED).toBeLessThan(CONGESTION.HIGH_SPEED);
  });
});

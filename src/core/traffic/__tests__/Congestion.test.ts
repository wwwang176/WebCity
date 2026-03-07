import { describe, it, expect } from 'vitest';
import { getCongestionRate, getSpeedMultiplier } from '../Congestion';

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
});

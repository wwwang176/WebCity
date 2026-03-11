import { describe, it, expect } from 'vitest';
import { POWER } from '../PowerGrid';

describe('POWER constants', () => {
  it('plant range should be positive', () => {
    expect(POWER.PLANT_RANGE).toBeGreaterThan(0);
  });

  it('relay range should be positive and less than plant range', () => {
    expect(POWER.RELAY_RANGE).toBeGreaterThan(0);
    expect(POWER.RELAY_RANGE).toBeLessThan(POWER.PLANT_RANGE);
  });
});

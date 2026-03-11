import { describe, it, expect } from 'vitest';
import { WATER_NETWORK } from '../WaterNetwork';

describe('WATER_NETWORK constants', () => {
  it('plant range should be positive', () => {
    expect(WATER_NETWORK.PLANT_RANGE).toBeGreaterThan(0);
  });

  it('relay range should be positive and less than plant range', () => {
    expect(WATER_NETWORK.RELAY_RANGE).toBeGreaterThan(0);
    expect(WATER_NETWORK.RELAY_RANGE).toBeLessThan(WATER_NETWORK.PLANT_RANGE);
  });
});

import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { isBlockedByElevation } from '../ElevationZoneBlock';

describe('isBlockedByElevation', () => {
  it('returns false when no elevated segments at cell', () => {
    const em = new ElevationManager();
    expect(isBlockedByElevation(em, 5, 5)).toBe(false);
  });

  it('returns true when elevated segment exists above cell', () => {
    const em = new ElevationManager();
    em.set(5, 5, 1, { roadType: 5, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    expect(isBlockedByElevation(em, 5, 5)).toBe(true);
  });

  it('returns true for ramp cell too', () => {
    const em = new ElevationManager();
    em.set(5, 5, 1, { roadType: 5, roadFlags: 0, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
    expect(isBlockedByElevation(em, 5, 5)).toBe(true);
  });
});

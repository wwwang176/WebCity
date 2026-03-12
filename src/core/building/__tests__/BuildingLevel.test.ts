import { describe, it, expect } from 'vitest';
import { clampBuildingLevel, BUILDING_LEVEL } from '../BuildingLevel';

describe('clampBuildingLevel (shared utility)', () => {
  it('returns level 1 for low coverage (0-3)', () => {
    expect(clampBuildingLevel(0)).toBe(1);
    expect(clampBuildingLevel(1)).toBe(1);
    expect(clampBuildingLevel(3)).toBe(1);
  });

  it('returns level 2 for medium coverage (4-6)', () => {
    expect(clampBuildingLevel(4)).toBe(2);
    expect(clampBuildingLevel(6)).toBe(2);
  });

  it('returns level 3 for high coverage (7+)', () => {
    expect(clampBuildingLevel(7)).toBe(3);
    expect(clampBuildingLevel(9)).toBe(3);
    expect(clampBuildingLevel(100)).toBe(3);
  });

  it('returns level 1 for NaN', () => {
    expect(clampBuildingLevel(NaN)).toBe(1);
  });

  it('returns level 1 for negative values', () => {
    expect(clampBuildingLevel(-5)).toBe(1);
  });

  it('BUILDING_LEVEL constants should be consistent', () => {
    expect(BUILDING_LEVEL.MIN).toBe(1);
    expect(BUILDING_LEVEL.MAX).toBe(3);
    expect(BUILDING_LEVEL.DIVISOR).toBe(3);
  });
});

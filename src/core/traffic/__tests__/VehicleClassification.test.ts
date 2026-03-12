import { describe, it, expect } from 'vitest';
import { classifyVehicleType, VEHICLE_TYPE_THRESHOLDS } from '../VehicleClassification';

describe('classifyVehicleType', () => {
  it('classifies bus for length >= 0.44', () => {
    expect(classifyVehicleType(0.44)).toBe('bus');
    expect(classifyVehicleType(0.5)).toBe('bus');
  });

  it('classifies firetruck for length >= 0.33 and < 0.44', () => {
    expect(classifyVehicleType(0.33)).toBe('firetruck');
    expect(classifyVehicleType(0.43)).toBe('firetruck');
  });

  it('classifies truck for length >= 0.28 and < 0.33', () => {
    expect(classifyVehicleType(0.28)).toBe('truck');
    expect(classifyVehicleType(0.32)).toBe('truck');
  });

  it('classifies car for length < 0.28', () => {
    expect(classifyVehicleType(0.2)).toBe('car');
    expect(classifyVehicleType(0.27)).toBe('car');
  });

  it('VEHICLE_TYPE_THRESHOLDS are sorted descending by threshold', () => {
    for (let i = 1; i < VEHICLE_TYPE_THRESHOLDS.length; i++) {
      expect(VEHICLE_TYPE_THRESHOLDS[i - 1]!.minLength).toBeGreaterThan(VEHICLE_TYPE_THRESHOLDS[i]!.minLength);
    }
  });
});

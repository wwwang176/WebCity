import { describe, it, expect } from 'vitest';
import { classifyVehicleType, VEHICLE_TYPE_THRESHOLDS } from '../VehicleClassification';

describe('classifyVehicleType', () => {
  it('classifies bus for length >= 0.58', () => {
    expect(classifyVehicleType(0.58)).toBe('bus');
    expect(classifyVehicleType(0.60)).toBe('bus');
  });

  it('classifies truck for length >= 0.35 and < 0.58', () => {
    expect(classifyVehicleType(0.35)).toBe('truck');
    expect(classifyVehicleType(0.57)).toBe('truck');
  });

  it('classifies van for length >= 0.24 and < 0.35', () => {
    expect(classifyVehicleType(0.24)).toBe('van');
    expect(classifyVehicleType(0.34)).toBe('van');
  });

  it('classifies car for length < 0.24', () => {
    expect(classifyVehicleType(0.2)).toBe('car');
    expect(classifyVehicleType(0.23)).toBe('car');
  });

  it('VEHICLE_TYPE_THRESHOLDS are sorted descending by threshold', () => {
    for (let i = 1; i < VEHICLE_TYPE_THRESHOLDS.length; i++) {
      expect(VEHICLE_TYPE_THRESHOLDS[i - 1]!.minLength).toBeGreaterThan(VEHICLE_TYPE_THRESHOLDS[i]!.minLength);
    }
  });
});

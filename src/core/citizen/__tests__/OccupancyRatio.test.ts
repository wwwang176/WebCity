import { describe, it, expect } from 'vitest';
import { computeOccupancyRatios } from '../OccupancyRatio';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    incomeLevel: IncomeLevel.LOW,
    happiness: 50,
    health: 80,
    homeId: null,
    workplaceId: null,
    ...overrides,
  };
}

describe('computeOccupancyRatios', () => {
  it('returns empty map when no buildings', () => {
    const result = computeOccupancyRatios([], []);
    expect(result.size).toBe(0);
  });

  it('returns 0 for empty residential building', () => {
    const buildings = [{ pos: '2,3', buildingId: 1 }]; // Small House, residents=4
    const result = computeOccupancyRatios([], buildings);
    expect(result.get('2,3')).toBe(0);
  });

  it('returns correct ratio for partially occupied residential building', () => {
    const buildings = [{ pos: '2,3', buildingId: 1 }]; // Small House, residents=4
    const citizens = [
      makeCitizen({ id: 1, homeId: '2,3' }),
      makeCitizen({ id: 2, homeId: '2,3' }),
    ];
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('2,3')).toBe(0.5); // 2/4
  });

  it('returns 1.0 for fully occupied residential building', () => {
    const buildings = [{ pos: '2,3', buildingId: 1 }]; // Small House, residents=4
    const citizens = [
      makeCitizen({ id: 1, homeId: '2,3' }),
      makeCitizen({ id: 2, homeId: '2,3' }),
      makeCitizen({ id: 3, homeId: '2,3' }),
      makeCitizen({ id: 4, homeId: '2,3' }),
    ];
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('2,3')).toBe(1.0);
  });

  it('clamps to 1.0 if over-occupied', () => {
    const buildings = [{ pos: '2,3', buildingId: 1 }]; // Small House, residents=4
    const citizens = [
      makeCitizen({ id: 1, homeId: '2,3' }),
      makeCitizen({ id: 2, homeId: '2,3' }),
      makeCitizen({ id: 3, homeId: '2,3' }),
      makeCitizen({ id: 4, homeId: '2,3' }),
      makeCitizen({ id: 5, homeId: '2,3' }),
    ];
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('2,3')).toBe(1.0);
  });

  it('uses workOccupancy for workplace buildings', () => {
    const buildings = [{ pos: '5,5', buildingId: 7 }]; // Small Shop, workers=4
    const citizens = [
      makeCitizen({ id: 1, workplaceId: '5,5' }),
      makeCitizen({ id: 2, workplaceId: '5,5' }),
    ];
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('5,5')).toBe(0.5); // 2/4
  });

  it('handles mixed residential and workplace buildings', () => {
    const buildings = [
      { pos: '2,3', buildingId: 1 }, // Small House, residents=4
      { pos: '5,5', buildingId: 7 }, // Small Shop, workers=4
    ];
    const citizens = [
      makeCitizen({ id: 1, homeId: '2,3', workplaceId: '5,5' }),
      makeCitizen({ id: 2, homeId: '2,3' }),
    ];
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('2,3')).toBe(0.5);  // 2/4 home
    expect(result.get('5,5')).toBe(0.25); // 1/4 work
  });

  it('ignores buildings with unknown buildingId', () => {
    const buildings = [{ pos: '1,1', buildingId: 999 }];
    const result = computeOccupancyRatios([], buildings);
    expect(result.has('1,1')).toBe(false);
  });

  it('handles high-rise with many residents', () => {
    const buildings = [{ pos: '3,3', buildingId: 4 }]; // Small Apartment, residents=80
    const citizens = Array.from({ length: 20 }, (_, i) =>
      makeCitizen({ id: i, homeId: '3,3' }),
    );
    const result = computeOccupancyRatios(citizens, buildings);
    expect(result.get('3,3')).toBe(0.25); // 20/80
  });
});

import { describe, it, expect } from 'vitest';
import {
  countOccupancy,
  assignToBuildings,
  type BuildingSlot,
} from '../OccupancyAssignment';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
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

describe('countOccupancy', () => {
  it('returns empty map for empty citizen list', () => {
    const result = countOccupancy([], (c) => c.homeId);
    expect(result.size).toBe(0);
  });

  it('counts citizens by their assigned position', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: '2,3' }),
      makeCitizen({ id: 2, homeId: '2,3' }),
      makeCitizen({ id: 3, homeId: '5,5' }),
      makeCitizen({ id: 4, homeId: null }),
    ];
    const result = countOccupancy(citizens, (c) => c.homeId);
    expect(result.get('2,3')).toBe(2);
    expect(result.get('5,5')).toBe(1);
    expect(result.size).toBe(2);
  });

  it('works for workplaceId', () => {
    const citizens = [
      makeCitizen({ id: 1, workplaceId: '1,1' }),
      makeCitizen({ id: 2, workplaceId: '1,1' }),
      makeCitizen({ id: 3, workplaceId: null }),
    ];
    const result = countOccupancy(citizens, (c) => c.workplaceId);
    expect(result.get('1,1')).toBe(2);
    expect(result.size).toBe(1);
  });
});

describe('assignToBuildings', () => {
  it('assigns citizens to buildings with capacity', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: null }),
      makeCitizen({ id: 2, homeId: null }),
    ];
    const buildings: BuildingSlot[] = [
      { pos: '2,3', capacity: 3 },
    ];
    const occupancy = new Map<string, number>();

    assignToBuildings(citizens, buildings, occupancy, (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    expect(citizens[0]!.homeId).toBe('2,3');
    expect(citizens[1]!.homeId).toBe('2,3');
    expect(occupancy.get('2,3')).toBe(2);
  });

  it('does not assign when building is full', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: null }),
      makeCitizen({ id: 2, homeId: null }),
    ];
    const buildings: BuildingSlot[] = [
      { pos: '2,3', capacity: 1 },
    ];
    const occupancy = new Map<string, number>();

    assignToBuildings(citizens, buildings, occupancy, (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    expect(citizens[0]!.homeId).toBe('2,3');
    expect(citizens[1]!.homeId).toBeNull(); // No space
  });

  it('skips citizens who already have assignment', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: '1,1' }),
      makeCitizen({ id: 2, homeId: null }),
    ];
    const buildings: BuildingSlot[] = [
      { pos: '2,3', capacity: 5 },
    ];
    const occupancy = new Map<string, number>();

    assignToBuildings(citizens, buildings, occupancy, (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    expect(citizens[0]!.homeId).toBe('1,1'); // Unchanged
    expect(citizens[1]!.homeId).toBe('2,3'); // Assigned
  });

  it('distributes across multiple buildings', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: null }),
      makeCitizen({ id: 2, homeId: null }),
      makeCitizen({ id: 3, homeId: null }),
    ];
    const buildings: BuildingSlot[] = [
      { pos: '1,1', capacity: 2 },
      { pos: '2,2', capacity: 2 },
    ];
    const occupancy = new Map<string, number>();

    assignToBuildings(citizens, buildings, occupancy, (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    expect(citizens[0]!.homeId).toBe('1,1');
    expect(citizens[1]!.homeId).toBe('1,1');
    expect(citizens[2]!.homeId).toBe('2,2');
  });

  it('respects existing occupancy', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: null }),
    ];
    const buildings: BuildingSlot[] = [
      { pos: '1,1', capacity: 2 },
    ];
    const occupancy = new Map<string, number>([['1,1', 2]]); // Already full

    assignToBuildings(citizens, buildings, occupancy, (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    expect(citizens[0]!.homeId).toBeNull(); // No space
  });
});

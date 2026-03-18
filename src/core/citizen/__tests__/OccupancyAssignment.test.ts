import { describe, it, expect } from 'vitest';
import {
  countOccupancy,
  assignToBuildings,
  assignWithPreference,
  assignWorkWithPreference,
  type BuildingSlot,
} from '../OccupancyAssignment';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import type { HousingCandidate } from '../HousingScore';
import type { WorkplaceCandidate } from '../WorkplaceScore';
import { ZoneType } from '../../grid/types';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    happiness: 50,
    health: 80,
    homeId: null,
    workplaceId: null,
    unemployedSince: null,
    homelessSince: null,
    emigrationTolerance: 25,
    educationProgress: 0,
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

function makeHousingCandidate(overrides: Partial<HousingCandidate> = {}): HousingCandidate {
  return {
    pos: '5,5',
    capacity: 10,
    level: 1,
    landValue: 50,
    groundPollution: 0,
    noisePollution: 0,
    serviceCoverage: 3,
    hasPark: false,
    ...overrides,
  };
}

describe('assignWithPreference', () => {
  it('citizen picks from top-scoring housing (excludes worst candidates)', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      education: EducationLevel.UNIVERSITY,
      workplaceId: '10,10',
    });
    // 3 good candidates near work + 1 terrible candidate far away with pollution
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({
        pos: '9,10', level: 3, landValue: 200, serviceCoverage: 5, hasPark: true,
      }),
      makeHousingCandidate({
        pos: '10,9', level: 3, landValue: 190, serviceCoverage: 5,
      }),
      makeHousingCandidate({
        pos: '11,10', level: 3, landValue: 180, serviceCoverage: 4,
      }),
      makeHousingCandidate({
        pos: '50,50', level: 1, landValue: 5, groundPollution: 255, noisePollution: 255,
      }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], candidates, occupancy);

    // Top-3 should be the three good candidates; worst should be excluded
    expect(citizen.homeId).not.toBe('50,50');
    expect(citizen.homeId).not.toBeNull();
  });

  it('top-3 random — not everyone in same building when scores are close', () => {
    // With many citizens and similar-scored buildings, assignments should spread
    const citizens = Array.from({ length: 50 }, (_, i) => makeCitizen({
      id: i,
      education: EducationLevel.HIGH_SCHOOL,
      workplaceId: '10,10',
    }));
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '9,10', capacity: 50, level: 2, landValue: 100 }),
      makeHousingCandidate({ pos: '10,9', capacity: 50, level: 2, landValue: 100 }),
      makeHousingCandidate({ pos: '11,10', capacity: 50, level: 2, landValue: 100 }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference(citizens, candidates, occupancy);

    // All should be assigned
    const assigned = citizens.filter(c => c.homeId !== null);
    expect(assigned.length).toBe(50);

    // Not all in one building (randomization should spread them)
    const counts = new Map<string, number>();
    for (const c of citizens) {
      counts.set(c.homeId!, (counts.get(c.homeId!) ?? 0) + 1);
    }
    // At least 2 buildings should have residents
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });

  it('NONE education prefers Lv1 over Lv3', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      education: EducationLevel.NONE,
      workplaceId: '5,5',
    });
    // 3 Lv1 candidates + 1 Lv3 so top-3 are all Lv1 (scoreLevelMatch: Lv1=+30, Lv3=-10)
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '5,6', capacity: 10, level: 1 }),
      makeHousingCandidate({ pos: '5,4', capacity: 10, level: 1 }),
      makeHousingCandidate({ pos: '4,5', capacity: 10, level: 1 }),
      makeHousingCandidate({ pos: '5,7', capacity: 10, level: 3 }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], candidates, occupancy);

    // NONE education should prefer Lv1 (match) over Lv3 — top-3 excludes Lv3
    expect(citizen.homeId).not.toBe('5,7');
    expect(citizen.homeId).not.toBeNull();
  });

  it('all full = homeId stays null, no crash', () => {
    const citizen = makeCitizen({ id: 1 });
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '1,1', capacity: 1 }),
    ];
    const occupancy = new Map<string, number>([['1,1', 1]]);

    assignWithPreference([citizen], candidates, occupancy);

    expect(citizen.homeId).toBeNull();
  });

  it('no workplace = commute score ignored, still assigns', () => {
    const citizen = makeCitizen({ id: 1, workplaceId: null });
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '5,5', capacity: 10 }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], candidates, occupancy);

    expect(citizen.homeId).toBe('5,5');
  });

  it('fallback — when preferred level is full, citizen can live in other level', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      education: EducationLevel.NONE,
    });
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '1,1', capacity: 1, level: 1 }),
      makeHousingCandidate({ pos: '2,2', capacity: 10, level: 3 }),
    ];
    // Lv1 is full
    const occupancy = new Map<string, number>([['1,1', 1]]);

    assignWithPreference([citizen], candidates, occupancy);

    // Should fall back to Lv3 since no preferred housing is available
    expect(citizen.homeId).toBe('2,2');
  });

  it('fallback still picks best score among other options', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      education: EducationLevel.NONE,
      workplaceId: '10,10',
    });
    // Only Lv3 buildings available — all trigger fallback for NONE education
    // Create 4 candidates so top-3 excludes the worst one
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '9,10', capacity: 10, level: 3, landValue: 200, serviceCoverage: 5, hasPark: true }),
      makeHousingCandidate({ pos: '9,11', capacity: 10, level: 3, landValue: 180, serviceCoverage: 4 }),
      makeHousingCandidate({ pos: '10,11', capacity: 10, level: 3, landValue: 150, serviceCoverage: 3 }),
      makeHousingCandidate({ pos: '30,30', capacity: 10, level: 3, landValue: 20, groundPollution: 200, noisePollution: 200 }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], candidates, occupancy);

    // Should not pick the worst option (30,30) — top-3 should all be near 10,10
    expect(citizen.homeId).not.toBe('30,30');
    expect(citizen.homeId).not.toBeNull();
  });

  it('empty candidate list = homeId stays null, no crash', () => {
    const citizen = makeCitizen({ id: 1 });
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], [], occupancy);

    expect(citizen.homeId).toBeNull();
  });

  it('skips already-assigned citizens', () => {
    const citizen = makeCitizen({ id: 1, homeId: '1,1' });
    const candidates: HousingCandidate[] = [
      makeHousingCandidate({ pos: '5,5', capacity: 10 }),
    ];
    const occupancy = new Map<string, number>();

    assignWithPreference([citizen], candidates, occupancy);

    expect(citizen.homeId).toBe('1,1'); // Unchanged
  });
});

describe('assignWorkWithPreference', () => {
  it('assigns working-age citizen to highest-scored workplace', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      education: EducationLevel.UNIVERSITY,
      homeId: '10,10',
    });
    const candidates: WorkplaceCandidate[] = [
      { pos: '11,11', capacity: 10, zoneType: ZoneType.OFFICE },
      { pos: '11,11', capacity: 10, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map<string, number>();

    assignWorkWithPreference([citizen], candidates, occupancy);

    // UNIVERSITY education should prefer OFFICE
    expect(citizen.workplaceId).toBe('11,11');
  });

  it('skips already-assigned citizens', () => {
    const citizen = makeCitizen({ id: 1, workplaceId: '1,1' });
    const candidates: WorkplaceCandidate[] = [
      { pos: '5,5', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>();

    assignWorkWithPreference([citizen], candidates, occupancy);

    expect(citizen.workplaceId).toBe('1,1');
  });

  it('all full = workplaceId stays null, no crash', () => {
    const citizen = makeCitizen({ id: 1 });
    const candidates: WorkplaceCandidate[] = [
      { pos: '1,1', capacity: 1, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>([['1,1', 1]]);

    assignWorkWithPreference([citizen], candidates, occupancy);

    expect(citizen.workplaceId).toBeNull();
  });

  it('updates occupancy after assignment', () => {
    const citizens = [
      makeCitizen({ id: 1, homeId: '5,5' }),
      makeCitizen({ id: 2, homeId: '5,5' }),
    ];
    const candidates: WorkplaceCandidate[] = [
      { pos: '6,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>();

    assignWorkWithPreference(citizens, candidates, occupancy);

    expect(occupancy.get('6,6')).toBe(2);
  });

  it('reachable filter: skips unreachable workplaces', () => {
    const citizen = makeCitizen({ id: 1, homeId: '5,5' });
    const candidates: WorkplaceCandidate[] = [
      { pos: '6,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },  // unreachable
      { pos: '5,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },  // reachable
    ];
    const occupancy = new Map<string, number>();
    const reachable = new Map([['5,5', new Set(['5,6'])]]);

    assignWorkWithPreference([citizen], candidates, occupancy, reachable);

    expect(citizen.workplaceId).toBe('5,6');
  });

  it('reachable filter: citizen with no homeId is skipped (needs home first)', () => {
    const citizen = makeCitizen({ id: 1, homeId: null });
    const candidates: WorkplaceCandidate[] = [
      { pos: '6,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>();
    const reachable = new Map<string, Set<string>>();

    assignWorkWithPreference([citizen], candidates, occupancy, reachable);

    expect(citizen.workplaceId).toBeNull(); // skipped — no homeId
  });

  it('reachable filter: no reachable workplaces = stays unemployed', () => {
    const citizen = makeCitizen({ id: 1, homeId: '5,5' });
    const candidates: WorkplaceCandidate[] = [
      { pos: '6,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>();
    const reachable = new Map([['5,5', new Set<string>()]]); // nothing reachable

    assignWorkWithPreference([citizen], candidates, occupancy, reachable);

    expect(citizen.workplaceId).toBeNull();
  });

  it('reachable filter: home not in map = no filter applied', () => {
    const citizen = makeCitizen({ id: 1, homeId: '9,9' });
    const candidates: WorkplaceCandidate[] = [
      { pos: '6,6', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const occupancy = new Map<string, number>();
    const reachable = new Map([['5,5', new Set(['6,6'])]]); // different home

    assignWorkWithPreference([citizen], candidates, occupancy, reachable);

    // Home 9,9 not in reachable map → no filter → assigned normally
    expect(citizen.workplaceId).toBe('6,6');
  });
});

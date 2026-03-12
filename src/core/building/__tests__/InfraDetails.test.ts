import { describe, it, expect } from 'vitest';
import { getInfraDetails, INFRA_DETAIL_EXTRACTORS, type InfraDetailContext } from '../InfraDetails';
import type { InfraType } from '../InfraConfig';

/** Minimal stub that satisfies InfraDetailContext. */
function makeCtx(overrides: Partial<InfraDetailContext> = {}): InfraDetailContext {
  return {
    police: { getStations: () => [], getCoverage: () => false },
    fire: { getStations: () => [], getActiveFires: () => [] },
    health: { getHospitals: () => [] },
    education: { getSchools: () => [] },
    parks: { getParks: () => [] },
    garbage: { getFacilities: () => [] },
    deathCare: { getCemeteries: () => [] },
    power: { getPlants: () => [] },
    water: { getPlants: () => [] },
    ...overrides,
  };
}

describe('getInfraDetails', () => {
  it('police: returns radius and coverage status', () => {
    const ctx = makeCtx({
      police: {
        getStations: () => [{ x: 5, y: 5, radius: 20 }],
        getCoverage: () => true,
      },
    });
    const d = getInfraDetails(ctx, 'police', 5, 5);
    expect(d).toEqual({ Radius: 20, Coverage: 'Yes' });
  });

  it('police: defaults when station not found', () => {
    const ctx = makeCtx();
    const d = getInfraDetails(ctx, 'police', 0, 0);
    expect(d.Radius).toBe(15);
    expect(d.Coverage).toBe('No');
  });

  it('fire: returns radius and active fire count', () => {
    const ctx = makeCtx({
      fire: {
        getStations: () => [{ x: 3, y: 3, radius: 18 }],
        getActiveFires: () => [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      },
    });
    const d = getInfraDetails(ctx, 'fire', 3, 3);
    expect(d).toEqual({ Radius: 18, 'Active Fires': 2 });
  });

  it('hospital: returns capacity and radius', () => {
    const ctx = makeCtx({
      health: { getHospitals: () => [{ x: 4, y: 4, capacity: 150, radius: 14 }] },
    });
    const d = getInfraDetails(ctx, 'hospital', 4, 4);
    expect(d).toEqual({ Capacity: 150, Radius: 14 });
  });

  it('school (elementary): returns type, capacity, radius', () => {
    const ctx = makeCtx({
      education: { getSchools: () => [{ x: 2, y: 2, type: 'elementary', capacity: 250, radius: 11 }] },
    });
    const d = getInfraDetails(ctx, 'school', 2, 2);
    expect(d).toEqual({ Type: 'Elementary', Capacity: 250, Radius: 11 });
  });

  it('school_high: filters by type=highschool', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [
          { x: 1, y: 1, type: 'elementary', capacity: 200, radius: 10 },
          { x: 1, y: 1, type: 'highschool', capacity: 350, radius: 13 },
        ],
      },
    });
    const d = getInfraDetails(ctx, 'school_high', 1, 1);
    expect(d).toEqual({ Type: 'High School', Capacity: 350, Radius: 13 });
  });

  it('school_univ: filters by type=university', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [{ x: 7, y: 7, type: 'university', capacity: 600, radius: 16 }],
      },
    });
    const d = getInfraDetails(ctx, 'school_univ', 7, 7);
    expect(d).toEqual({ Type: 'University', Capacity: 600, Radius: 16 });
  });

  it('park: returns radius', () => {
    const ctx = makeCtx({
      parks: { getParks: () => [{ x: 6, y: 6, radius: 8 }] },
    });
    const d = getInfraDetails(ctx, 'park', 6, 6);
    expect(d).toEqual({ Radius: 8 });
  });

  it('garbage: returns capacity and load', () => {
    const ctx = makeCtx({
      garbage: { getFacilities: () => [{ x: 3, y: 3, capacity: 2000, currentLoad: 500 }] },
    });
    const d = getInfraDetails(ctx, 'garbage', 3, 3);
    expect(d).toEqual({ Capacity: 2000, Load: 500 });
  });

  it('sewage: returns static status', () => {
    const d = getInfraDetails(makeCtx(), 'sewage', 0, 0);
    expect(d).toEqual({ Status: 'Active' });
  });

  it('cemetery: returns capacity and used', () => {
    const ctx = makeCtx({
      deathCare: { getCemeteries: () => [{ x: 5, y: 5, capacity: 800, used: 120 }] },
    });
    const d = getInfraDetails(ctx, 'cemetery', 5, 5);
    expect(d).toEqual({ Capacity: 800, Used: 120 });
  });

  it('power: returns output and type', () => {
    const ctx = makeCtx({
      power: { getPlants: () => [{ x: 2, y: 2, output: 750, type: 'solar' }] },
    });
    const d = getInfraDetails(ctx, 'power', 2, 2);
    expect(d).toEqual({ Output: 750, Type: 'solar' });
  });

  it('water: returns output', () => {
    const ctx = makeCtx({
      water: { getPlants: () => [{ x: 1, y: 1, output: 600 }] },
    });
    const d = getInfraDetails(ctx, 'water', 1, 1);
    expect(d).toEqual({ Output: 600 });
  });

  it('airport: returns static status', () => {
    const d = getInfraDetails(makeCtx(), 'airport', 0, 0);
    expect(d).toEqual({ Status: 'Operational' });
  });

  it('unknown type returns empty object', () => {
    const d = getInfraDetails(makeCtx(), 'bus_stop' as InfraType, 0, 0);
    expect(d).toEqual({});
  });
});

describe('INFRA_DETAIL_EXTRACTORS', () => {
  it('should have extractors for 13 infrastructure types', () => {
    const keys = Object.keys(INFRA_DETAIL_EXTRACTORS);
    expect(keys.length).toBe(13);
  });

  it('each extractor should be a function', () => {
    for (const fn of Object.values(INFRA_DETAIL_EXTRACTORS)) {
      expect(typeof fn).toBe('function');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { getInfraDetails, INFRA_DETAIL_EXTRACTORS, type InfraDetailContext } from '../InfraDetails';
import type { InfraType } from '../InfraConfig';

/** Minimal stub that satisfies InfraDetailContext. */
function makeCtx(overrides: Partial<InfraDetailContext> = {}): InfraDetailContext {
  return {
    police: { getStations: () => [], getCoverage: () => false },
    fire: { getStations: () => [], getActiveFires: () => [], getRecentExtinguished: () => 0 },
    health: { getHospitals: () => [], getHospitalLoad: () => 0 },
    education: { getSchools: () => [], getSchoolEnrollment: () => 0 },
    parks: { getParks: () => [] },
    garbage: { getFacilities: () => [] },
    deathCare: { getCemeteries: () => [] },
    power: { getPlants: () => [], getSupply: () => 0, getDemand: () => 0, getSupplyRatio: () => 1 },
    water: { getPlants: () => [], getSupply: () => 0, getDemand: () => 0, getSupplyRatio: () => 1 },
    citizens: { getCitizens: () => [], getEnrolledCounts: () => ({ elementary: 0, highSchool: 0, university: 0 }) },
    sewage: { getTreatmentPlants: () => [], getUntreated: () => 0 },
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

  it('fire: returns radius, active fires, and extinguished/month', () => {
    const ctx = makeCtx({
      fire: {
        getStations: () => [{ x: 3, y: 3, radius: 18 }],
        getActiveFires: () => [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        getRecentExtinguished: () => 7,
      },
    });
    const d = getInfraDetails(ctx, 'fire', 3, 3);
    expect(d).toEqual({ Radius: 18, 'Active Fires': 2, 'Extinguished/month': 7 });
  });

  it('hospital: returns load/capacity and radius', () => {
    const ctx = makeCtx({
      health: {
        getHospitals: () => [{ id: 'h1', x: 10, y: 10, capacity: 150, radius: 12 }],
        getHospitalLoad: (id: string) => id === 'h1' ? 45 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'hospital', 10, 10);
    expect(d).toEqual({ Load: '45 / 150', Radius: 12 });
  });

  it('school (elementary): returns per-school enrolled / capacity', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [{ id: 's1', x: 2, y: 2, type: 'elementary', capacity: 250, radius: 11 }],
        getSchoolEnrollment: (id: string) => id === 's1' ? 45 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school', 2, 2);
    expect(d).toEqual({ Type: 'Elementary', Students: '45 / 250', Radius: 11 });
  });

  it('school_high: returns per-school enrolled / capacity', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [
          { id: 's1', x: 1, y: 1, type: 'elementary', capacity: 200, radius: 10 },
          { id: 's2', x: 1, y: 1, type: 'highschool', capacity: 350, radius: 13 },
        ],
        getSchoolEnrollment: (id: string) => id === 's2' ? 120 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school_high', 1, 1);
    expect(d).toEqual({ Type: 'High School', Students: '120 / 350', Radius: 13 });
  });

  it('school_univ: returns per-school enrolled / capacity', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [{ id: 's1', x: 7, y: 7, type: 'university', capacity: 600, radius: 16 }],
        getSchoolEnrollment: (id: string) => id === 's1' ? 88 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school_univ', 7, 7);
    expect(d).toEqual({ Type: 'University', Students: '88 / 600', Radius: 16 });
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

  it('sewage: returns capacity and untreated', () => {
    const ctx = makeCtx({
      sewage: {
        getTreatmentPlants: () => [{ x: 5, y: 5, capacity: 200 }],
        getUntreated: () => 3,
      },
    });
    const d = getInfraDetails(ctx, 'sewage', 5, 5);
    expect(d).toEqual({ Capacity: 200, Untreated: 3 });
  });

  it('sewage: defaults when plant not found', () => {
    const d = getInfraDetails(makeCtx(), 'sewage', 0, 0);
    expect(d.Capacity).toBe(200);
    expect(d.Untreated).toBe(0);
  });

  it('cemetery: returns capacity, stored, and recent monthly', () => {
    const recentDaily = new Array(30).fill(0);
    recentDaily[0] = 5;
    recentDaily[1] = 3;
    const ctx = makeCtx({
      deathCare: { getCemeteries: () => [{ x: 5, y: 5, capacity: 800, used: 120, recentDaily, recentIndex: 2, todayCremated: 0 }] },
    });
    const d = getInfraDetails(ctx, 'cemetery', 5, 5);
    expect(d).toEqual({ Capacity: 800, Stored: 120, 'Recent/month': 8 });
  });

  it('power: returns output, type, and city supply/demand info', () => {
    const ctx = makeCtx({
      power: {
        getPlants: () => [{ x: 2, y: 2, output: 750, type: 'solar' }],
        getSupply: () => 750,
        getDemand: () => 500,
        getSupplyRatio: () => 1,
      },
    });
    const d = getInfraDetails(ctx, 'power', 2, 2);
    expect(d.Output).toBe(750);
    expect(d.Type).toBe('solar');
    expect(d['City Supply']).toBe(750);
    expect(d['City Demand']).toBe(500);
    expect(d['Supply Ratio']).toBe('100.0%');
  });

  it('water: returns output and city supply/demand info', () => {
    const ctx = makeCtx({
      water: {
        getPlants: () => [{ x: 1, y: 1, output: 600 }],
        getSupply: () => 600,
        getDemand: () => 400,
        getSupplyRatio: () => 1.5,
      },
    });
    const d = getInfraDetails(ctx, 'water', 1, 1);
    expect(d.Output).toBe(600);
    expect(d['City Supply']).toBe(600);
    expect(d['City Demand']).toBe(400);
    expect(d['Supply Ratio']).toBe('150.0%');
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

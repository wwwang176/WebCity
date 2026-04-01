import { describe, it, expect } from 'vitest';
import { getInfraDetails, INFRA_DETAIL_EXTRACTORS, type InfraDetailContext } from '../InfraDetails';
import type { InfraType } from '../InfraConfig';

/** Minimal stub that satisfies InfraDetailContext. */
function makeCtx(overrides: Partial<InfraDetailContext> = {}): InfraDetailContext {
  return {
    police: { getStations: () => [], getCoverage: () => false, getStationLoad: () => 0 },
    fire: { getStations: () => [], getActiveFires: () => [], getRecentExtinguished: () => 0, getStationLoad: () => 0 },
    health: { getHospitals: () => [], getHospitalLoad: () => 0 },
    education: { getSchools: () => [], getSchoolEnrollment: () => 0, getSchoolDemand: () => 0 },
    parks: { getParks: () => [] },
    garbage: { getFacilities: () => [] },
    deathCare: { getCemeteries: () => [] },
    power: { getPlants: () => [], getSupply: () => 0, getDemand: () => 0, getSupplyRatio: () => 1 },
    water: { getPlants: () => [], getSupply: () => 0, getDemand: () => 0, getSupplyRatio: () => 1 },
    citizens: { getCitizens: () => [], getEnrolledCounts: () => ({ elementary: 0, highSchool: 0, university: 0 }) },
    sewage: { getTreatmentPlants: () => [], getUntreated: () => 0, getProduced: () => 0 },
    ...overrides,
  };
}

describe('getInfraDetails', () => {
  it('police: returns need, capacity, and radius', () => {
    const ctx = makeCtx({
      police: {
        getStations: () => [{ id: 'p1', x: 5, y: 5, radius: 20, capacity: 500 }],
        getCoverage: () => true,
        getStationLoad: (id: string) => id === 'p1' ? 300 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'police', 5, 5);
    expect(d).toEqual({ Need: 300, Capacity: 500, Radius: 20 });
  });

  it('police: defaults when station not found', () => {
    const ctx = makeCtx();
    const d = getInfraDetails(ctx, 'police', 0, 0);
    expect(d).toEqual({ Need: 0, Capacity: 500, Radius: 15 });
  });

  it('fire: returns need, capacity, radius, and active fires', () => {
    const ctx = makeCtx({
      fire: {
        getStations: () => [{ id: 'f1', x: 3, y: 3, radius: 18, capacity: 500 }],
        getActiveFires: () => [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        getRecentExtinguished: () => 7,
        getStationLoad: (id: string) => id === 'f1' ? 200 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'fire', 3, 3);
    expect(d).toEqual({ Need: 200, Capacity: 500, Radius: 18, 'Active Fires': 2 });
  });

  it('hospital: returns need, capacity, and radius', () => {
    const ctx = makeCtx({
      health: {
        getHospitals: () => [{ id: 'h1', x: 10, y: 10, capacity: 150, radius: 12 }],
        getHospitalLoad: (id: string) => id === 'h1' ? 45 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'hospital', 10, 10);
    expect(d).toEqual({ Need: 45, Capacity: 150, Radius: 12 });
  });

  it('school (elementary): shows need and students separately', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [{ id: 's1', x: 2, y: 2, type: 'elementary', capacity: 250, radius: 11 }],
        getSchoolEnrollment: (id: string) => id === 's1' ? 250 : 0,
        getSchoolDemand: (id: string) => id === 's1' ? 350 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school', 2, 2);
    expect(d).toEqual({ Type: 'Elementary', Need: 350, Capacity: 250, Students: '250 / 250', Radius: 11 });
  });

  it('school_high: need shown even when within capacity', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [
          { id: 's1', x: 1, y: 1, type: 'elementary', capacity: 200, radius: 10 },
          { id: 's2', x: 1, y: 1, type: 'highschool', capacity: 350, radius: 13 },
        ],
        getSchoolEnrollment: (id: string) => id === 's2' ? 120 : 0,
        getSchoolDemand: (id: string) => id === 's2' ? 200 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school_high', 1, 1);
    expect(d).toEqual({ Type: 'High School', Need: 200, Capacity: 350, Students: '120 / 350', Radius: 13 });
  });

  it('school_univ: returns need, students, and capacity', () => {
    const ctx = makeCtx({
      education: {
        getSchools: () => [{ id: 's1', x: 7, y: 7, type: 'university', capacity: 600, radius: 16 }],
        getSchoolEnrollment: (id: string) => id === 's1' ? 88 : 0,
        getSchoolDemand: (id: string) => id === 's1' ? 88 : 0,
      },
    });
    const d = getInfraDetails(ctx, 'school_univ', 7, 7);
    expect(d).toEqual({ Type: 'University', Need: 88, Capacity: 600, Students: '88 / 600', Radius: 16 });
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

  it('sewage: returns need and capacity', () => {
    const ctx = makeCtx({
      sewage: {
        getTreatmentPlants: () => [{ x: 5, y: 5, capacity: 2250 }],
        getUntreated: () => 3,
        getProduced: () => 800,
      },
    });
    const d = getInfraDetails(ctx, 'sewage', 5, 5);
    expect(d).toEqual({ Need: 800, Capacity: 2250 });
  });

  it('sewage: defaults when plant not found', () => {
    const d = getInfraDetails(makeCtx(), 'sewage', 0, 0);
    expect(d.Need).toBe(0);
    expect(d.Capacity).toBe(2250);
  });

  it('cemetery: returns need, capacity, stored, and pending', () => {
    const recentDaily = new Array(30).fill(0);
    const ctx = makeCtx({
      deathCare: { getCemeteries: () => [{ x: 5, y: 5, capacity: 800, used: 120, pending: 3, recentDaily, recentIndex: 0, todayCremated: 0 }] },
    });
    const d = getInfraDetails(ctx, 'cemetery', 5, 5);
    expect(d).toEqual({ Need: 123, Capacity: 800, Stored: 120, Pending: 3 });
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

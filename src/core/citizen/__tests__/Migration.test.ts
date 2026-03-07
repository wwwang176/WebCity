import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { migrationTick, calculateAttractiveness, type CityAttractiveness } from '../Migration';

const attractiveCity: CityAttractiveness = {
  jobOpenings: 10,
  vacantHomes: 10,
  avgHappiness: 70,
  taxRate: 9,
  pollution: 10,
  crimeRate: 10,
};

describe('Migration', () => {
  it('should immigrate when city is attractive', () => {
    const mgr = new CitizenManager();
    const result = migrationTick(mgr, attractiveCity);
    expect(result.immigrated).toBeGreaterThan(0);
    expect(mgr.getPopulation()).toBeGreaterThan(0);
  });

  it('should not immigrate when no vacant homes', () => {
    const mgr = new CitizenManager();
    const result = migrationTick(mgr, { ...attractiveCity, vacantHomes: 0 });
    expect(result.immigrated).toBe(0);
  });

  it('should not immigrate when no job openings', () => {
    const mgr = new CitizenManager();
    const result = migrationTick(mgr, { ...attractiveCity, jobOpenings: 0 });
    expect(result.immigrated).toBe(0);
  });

  it('should emigrate unhappy citizens', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ happiness: 10 });
    mgr.createCitizen({ happiness: 10 });
    const result = migrationTick(mgr, attractiveCity);
    expect(result.emigrated).toBe(2);
    expect(mgr.getPopulation()).toBeGreaterThanOrEqual(0);
  });

  it('should calculate attractiveness correctly', () => {
    const score = calculateAttractiveness(attractiveCity);
    expect(score).toBeGreaterThan(50);
  });

  it('should have low attractiveness for bad city', () => {
    const score = calculateAttractiveness({
      jobOpenings: 0,
      vacantHomes: 0,
      avgHappiness: 20,
      taxRate: 20,
      pollution: 80,
      crimeRate: 80,
    });
    expect(score).toBeLessThan(30);
  });
});

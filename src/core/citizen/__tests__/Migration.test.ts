import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { migrationTick, calculateAttractiveness, getImmigrationCap, ATTRACTIVENESS, IMMIGRATION, type CityAttractiveness } from '../Migration';

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

/* ── Phase A: 移民動態縮放 ── */
describe('getImmigrationCap — 移民動態縮放', () => {
  it('小城市上限：population=100 → cap=3（保持不變）', () => {
    // popCap = max(3, floor(100*0.01)) = max(3,1) = 3
    // demandCap = ceil((80-50)/10) = 3
    // min(3, 100, 3) = 3
    const cap = getImmigrationCap(100, 100, 80);
    expect(cap).toBe(3);
  });

  it('中城市縮放：population=5000, vacantHomes=100, attractiveness=80 → 移入上限高於 3', () => {
    // popCap = max(3, floor(5000*0.01)) = 50
    // demandCap = ceil((80-50)/10) = 3
    // min(50, 100, 3) = 3
    const cap = getImmigrationCap(5000, 100, 80);
    expect(cap).toBe(3);
  });

  it('高吸引力大城市：population=10000, vacantHomes=200, attractiveness=95 → 更高上限', () => {
    // popCap = max(3, floor(10000*0.01)) = 100
    // demandCap = ceil((95-50)/10) = 5
    // min(100, 200, 5) = 5
    const cap = getImmigrationCap(10000, 200, 95);
    expect(cap).toBe(5);
  });

  it('空房瓶頸：population=50000, vacantHomes=2 → 最多移入 2 人', () => {
    // popCap = max(3, floor(50000*0.01)) = 500
    // demandCap = ceil((80-50)/10) = 3
    // min(500, 2, 3) = 2
    const cap = getImmigrationCap(50000, 2, 80);
    expect(cap).toBe(2);
  });

  it('向下相容：attractiveness ≤ 50 → 移入 0 人', () => {
    expect(getImmigrationCap(5000, 100, 50)).toBe(0);
    expect(getImmigrationCap(5000, 100, 30)).toBe(0);
  });

  it('emigration 不受 getImmigrationCap 影響', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ happiness: 10 });
    mgr.createCitizen({ happiness: 10 });
    // 即使吸引力很低，emigration 仍然照常運作
    const result = migrationTick(mgr, {
      ...attractiveCity,
      avgHappiness: 10,
      jobOpenings: 0,
      vacantHomes: 0,
    }, 100);
    expect(result.emigrated).toBe(2);
  });

  it('ATTRACTIVENESS constants should have valid weights', () => {
    expect(ATTRACTIVENESS.JOB_SCORE).toBeGreaterThan(0);
    expect(ATTRACTIVENESS.VACANT_SCORE).toBeGreaterThan(0);
    expect(ATTRACTIVENESS.MAX).toBeGreaterThan(ATTRACTIVENESS.MIN);
  });

  it('IMMIGRATION constants should be consistent', () => {
    expect(IMMIGRATION.ATTRACTIVENESS_THRESHOLD).toBeGreaterThan(0);
    expect(IMMIGRATION.POP_CAP_MIN).toBeGreaterThan(0);
    expect(IMMIGRATION.EMIGRATION_HAPPINESS_THRESHOLD).toBeGreaterThan(0);
    expect(IMMIGRATION.IMMIGRANT_MIN_AGE).toBeGreaterThanOrEqual(18);
  });
});

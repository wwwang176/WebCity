import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { migrationTick, calculateAttractiveness, getImmigrationCap, ATTRACTIVENESS, IMMIGRATION, EDUCATION_THRESHOLDS, CHILD_EDUCATION, ATTRITION, type CityAttractiveness } from '../Migration';
import { EMIGRATION_TOLERANCE, calculateEmigrationTolerance, EducationLevel } from '../types';
import { calculateLandValue } from '../../economy/LandValue';
import { MAX_SERVICE_SCORE } from '../../service/ServiceCoverageQuery';
import { MAX_ORDINARY_LAND_VALUE } from '../Migration';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';

const attractiveCity: CityAttractiveness = {
  jobOpenings: 10,
  vacantHomes: 10,
  avgHappiness: 70,
  taxRate: 9,
  pollution: 10,
  crimeRate: 10,
};

describe('Migration', () => {
  // Deterministic ticks: see useSeededRandom.
  useSeededRandom();

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

  it('should emigrate unhappy citizens (capped at 1-3% of population) plus natural attrition', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 100; i++) mgr.createCitizen({ happiness: 10 })!;
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 10, taxRate: 20, pollution: 50, crimeRate: 50 };
    const result = migrationTick(mgr, badCity, 100);
    // Unhappy emigration: base(0-10) + 1-3%(1-3) = 0-13
    // Natural attrition: floor(100 * 0.002) = 0 (too small at 100 pop)
    expect(result.emigrated).toBeGreaterThanOrEqual(0);
    expect(result.emigrated).toBeLessThanOrEqual(13);
    expect(mgr.getPopulation()).toBe(100 - result.emigrated);
  });

  it('should eventually emigrate all unhappy citizens over many ticks', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 20; i++) mgr.createCitizen({ happiness: 10 })!;
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 10, taxRate: 20, pollution: 50, crimeRate: 50 };
    let totalEmigrated = 0;
    for (let tick = 0; tick < 500; tick++) {
      const pop = mgr.getPopulation();
      if (pop === 0) break;
      const result = migrationTick(mgr, badCity, pop);
      totalEmigrated += result.emigrated;
    }
    expect(totalEmigrated).toBe(20);
    expect(mgr.getPopulation()).toBe(0);
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

/* ── Immigration cap scaling ── */
describe('getImmigrationCap — 移民動態縮放', () => {
  // Deterministic ticks: see useSeededRandom.
  useSeededRandom();

  it('小城市上限：population=100 → tier=2, cap=3（popCap 瓶頸）', () => {
    // popCap = max(3, floor(100*0.01)) = 3
    // baseDemand = ceil((80-50)/10) = 3, tier = floor(log10(100)) = 2, demandCap = 6
    // min(3, 100, 6) = 3
    const cap = getImmigrationCap(100, 100, 80);
    expect(cap).toBe(3);
  });

  it('中城市縮放：population=5000 → tier=3, demandCap=12', () => {
    // popCap = max(3, floor(5000*0.01)) = 50
    // baseDemand = ceil((80-40)/10) = 4, tier = floor(log10(5000)) = 3, demandCap = 12
    // min(50, 100, 12) = 12
    const cap = getImmigrationCap(5000, 100, 80);
    expect(cap).toBe(12);
  });

  it('高吸引力大城市：population=10000 → tier=4, demandCap=24', () => {
    // popCap = max(3, floor(10000*0.01)) = 100
    // baseDemand = ceil((95-40)/10) = 6, tier = floor(log10(10000)) = 4, demandCap = 24
    // min(100, 200, 24) = 24
    const cap = getImmigrationCap(10000, 200, 95);
    expect(cap).toBe(24);
  });

  it('空房瓶頸：population=50000, vacantHomes=2 → 最多移入 2 人', () => {
    // popCap = max(3, floor(50000*0.01)) = 500
    // baseDemand = ceil((80-50)/10) = 3, tier = floor(log10(50000)) = 4, demandCap = 12
    // min(500, 2, 12) = 2
    const cap = getImmigrationCap(50000, 2, 80);
    expect(cap).toBe(2);
  });

  it('向下相容：attractiveness ≤ 40 → 移入 0 人', () => {
    expect(getImmigrationCap(5000, 100, 40)).toBe(0);
    expect(getImmigrationCap(5000, 100, 30)).toBe(0);
  });

  it('emigration 不受 getImmigrationCap 影響', () => {
    const mgr = new CitizenManager();
    // Use 200 unhappy citizens; emigration cap = base(0-10) + 1-3%(2-6) ≥ 2 reliably
    for (let i = 0; i < 200; i++) mgr.createCitizen({ happiness: 5, emigrationTolerance: 20 })!;
    const result = migrationTick(mgr, {
      ...attractiveCity,
      avgHappiness: 10,
      jobOpenings: 0,
      vacantHomes: 0,
    }, 200);
    expect(result.emigrated).toBeGreaterThanOrEqual(1);
  });

  it('high unemployment rate reduces attractiveness', () => {
    const noUnemployment = calculateAttractiveness({ ...attractiveCity, unemploymentRate: 0 });
    const highUnemployment = calculateAttractiveness({ ...attractiveCity, unemploymentRate: 0.5 });
    expect(highUnemployment).toBeLessThan(noUnemployment);
  });

  /**
   * These two cases used to assert that total unemployment still left a city
   * above the immigration threshold, on the stated ground that the penalty
   * should be "moderate". Their premise no longer holds.
   *
   * They were written when jobOpenings meant `totalJobs - population`, under
   * which `jobOpenings > 0` implied jobs outnumbered people and unemployment
   * was therefore structurally low — the two could not diverge far. Once
   * countJobOpenings became `totalJobs - employed`, they became independent,
   * and a flat +20 job bonus against a penalty capped at 15 made a city with
   * jobs nobody can reach NET MORE attractive than one with neither. That is
   * the runaway loop BUG-166 describes: an industrial park across an unbuilt
   * link keeps inviting people who cannot get to it.
   *
   * The penalty is still moderate at moderate unemployment. What changed is
   * that jobs no longer attract anyone once nobody can take them.
   */
  it('should make unemployment cost more the higher it climbs', () => {
    const at = (rate: number) => calculateAttractiveness({ ...attractiveCity, unemploymentRate: rate });
    expect(at(1.0)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0));
  });

  it('should still attract immigrants at ordinary unemployment', () => {
    const mgr = new CitizenManager();
    const result = migrationTick(mgr, { ...attractiveCity, unemploymentRate: 0.1 });
    expect(result.immigrated).toBeGreaterThan(0);
  });

  it('should stop attracting them when the jobs are unreachable', () => {
    const mgr = new CitizenManager();
    const result = migrationTick(mgr, { ...attractiveCity, unemploymentRate: 1.0 });
    expect(result.immigrated).toBe(0);
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

  it('natural attrition removes citizens even when all are happy', () => {
    const mgr = new CitizenManager();
    // 1000 happy citizens → attrition = floor(1000 * 0.002) = 2
    for (let i = 0; i < 1000; i++) mgr.createCitizen({ happiness: 80 })!;
    const stableCity = { ...attractiveCity, jobOpenings: 0, vacantHomes: 0 };
    const result = migrationTick(mgr, stableCity, 1000);
    // No unhappy emigration, but natural attrition should remove some
    expect(result.emigrated).toBe(2);
    expect(mgr.getPopulation()).toBe(998);
  });

  it('natural attrition is 0 for very small populations', () => {
    const mgr = new CitizenManager();
    // 50 citizens → min(5, floor(50 * 0.002)) = min(5, 0) = 0
    for (let i = 0; i < 50; i++) mgr.createCitizen({ happiness: 80 })!;
    const stableCity = { ...attractiveCity, jobOpenings: 0, vacantHomes: 0 };
    const result = migrationTick(mgr, stableCity, 50);
    expect(result.emigrated).toBe(0);
  });

  it('natural attrition is capped at 5 for large populations', () => {
    const mgr = new CitizenManager();
    // 20000 citizens → min(5, floor(20000 * 0.002)) = min(5, 40) = 5
    for (let i = 0; i < 20000; i++) mgr.createCitizen({ happiness: 80 })!;
    const stableCity = { ...attractiveCity, jobOpenings: 0, vacantHomes: 0 };
    const result = migrationTick(mgr, stableCity, 20000);
    expect(result.emigrated).toBe(5);
    expect(mgr.getPopulation()).toBe(19995);
  });
});

/* ── emigrationTolerance: the per-citizen emigration threshold ── */
describe('emigrationTolerance — 個人化遷出門檻', () => {
  it('calculateEmigrationTolerance returns values in expected range', () => {
    for (let i = 0; i < 100; i++) {
      const t = calculateEmigrationTolerance(EducationLevel.NONE);
      // NONE(18) ± 5 = 13~23
      expect(t).toBeGreaterThanOrEqual(13);
      expect(t).toBeLessThanOrEqual(23);
    }
    for (let i = 0; i < 100; i++) {
      const t = calculateEmigrationTolerance(EducationLevel.UNIVERSITY);
      // UNI(30) ± 5 = 25~35
      expect(t).toBeGreaterThanOrEqual(25);
      expect(t).toBeLessThanOrEqual(35);
    }
  });

  it('citizens get emigrationTolerance on creation', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ education: EducationLevel.HIGH_SCHOOL })!;
    // HS(26) ± 5 = 21~31
    expect(c.emigrationTolerance).toBeGreaterThanOrEqual(21);
    expect(c.emigrationTolerance).toBeLessThanOrEqual(31);
  });

  it('higher-education citizens emigrate at higher happiness than lower-education', () => {
    const mgr = new CitizenManager();
    // Create citizens with happiness 25 — above NONE tolerance but below UNIVERSITY tolerance
    for (let i = 0; i < 100; i++) {
      mgr.createCitizen({
        happiness: 25,
        education: EducationLevel.UNIVERSITY,
        emigrationTolerance: 35, // fixed for determinism
      })!;
    }
    for (let i = 0; i < 100; i++) {
      mgr.createCitizen({
        happiness: 25,
        education: EducationLevel.NONE,
        emigrationTolerance: 18, // fixed for determinism
      })!;
    }
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 25, taxRate: 20, pollution: 50, crimeRate: 50 };
    const result = migrationTick(mgr, badCity, 200);
    // UNI (tolerance 35) should emigrate (happiness 25 < 35)
    // NONE (tolerance 18) should NOT emigrate (happiness 25 > 18)
    // Only UNI citizens leave (up to emigration cap)
    const remainingUni = mgr.getCitizens().filter(c => c.education === EducationLevel.UNIVERSITY).length;
    const remainingNone = mgr.getCitizens().filter(c => c.education === EducationLevel.NONE).length;
    expect(remainingNone).toBeGreaterThanOrEqual(98); // nearly all stay (natural attrition may take 1-2)
    expect(remainingUni).toBeLessThan(remainingNone); // more UNI leave than NONE
  });

  it('legacy citizens without emigrationTolerance use fallback', () => {
    const mgr = new CitizenManager();
    // Simulate legacy save: create citizen then strip tolerance
    const c = mgr.createCitizen({ happiness: 20 })!;
    (c as any).emigrationTolerance = undefined;
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 20, taxRate: 20, pollution: 50, crimeRate: 50 };
    // happiness 20 < fallback 25 → should emigrate (if within cap)
    const result = migrationTick(mgr, badCity, 1);
    // With base 0-10 cap, may or may not emigrate, but the threshold check should use fallback 20
    expect(result.emigrated).toBeGreaterThanOrEqual(0);
  });
});

describe('migrationTick — emigration+attrition no duplicate removal', () => {
  it('emigratedIds should contain no duplicates', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 500; i++) mgr.createCitizen({ happiness: 5, emigrationTolerance: 50 })!;
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 5, taxRate: 20, pollution: 50, crimeRate: 50 };
    const result = migrationTick(mgr, badCity, 500);
    const unique = new Set(result.emigratedIds);
    expect(unique.size).toBe(result.emigratedIds.length);
  });

  it('population after emigration matches emigrated count', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 200; i++) mgr.createCitizen({ happiness: 5, emigrationTolerance: 50 })!;
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 5, taxRate: 20, pollution: 50, crimeRate: 50 };
    const result = migrationTick(mgr, badCity, 200);
    expect(mgr.getPopulation()).toBe(200 - result.emigrated);
  });

  it('emigratedIds only contains IDs that were actually in the population', () => {
    const mgr = new CitizenManager();
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) {
      const c = mgr.createCitizen({ happiness: 5, emigrationTolerance: 50 })!;
      ids.push(c.id);
    }
    const badCity = { jobOpenings: 0, vacantHomes: 0, avgHappiness: 5, taxRate: 20, pollution: 50, crimeRate: 50 };
    const result = migrationTick(mgr, badCity, 100);
    for (const eid of result.emigratedIds) {
      expect(ids).toContain(eid);
    }
  });
});

describe('Migration constants', () => {
  it('EDUCATION_THRESHOLDS should have correct values', () => {
    expect(EDUCATION_THRESHOLDS.OFFICE_RATIO).toBe(0.3);
    expect(EDUCATION_THRESHOLDS.INDUSTRIAL_RATIO).toBe(0.5);
    // AVG_LAND_VALUE is asserted separately, against what a city can reach
    // rather than against a literal — see the block below.
    expect(EDUCATION_THRESHOLDS.LOW_TAX).toBe(7);
    expect(EDUCATION_THRESHOLDS.HIGH_TAX).toBe(12);
  });

  /**
   * The old assertion pinned AVG_LAND_VALUE to the literal 100 and justified it
   * against the per-cell MAXIMUM of 125 — which needs a waterfront cell, while
   * the value compared against it is getAvgLandValue(), an average over every
   * building in the city. An ordinary inland cell tops out at 105 and
   * updateLandValue always deducts crimeRate x 0.4, so even a perfect city
   * averaged about 97 and the HIGH_LAND_VALUE weighting stayed dead code.
   *
   * Pin the property instead: a city that has done everything right must clear
   * the threshold, and a mediocre one must not.
   */
  describe('AVG_LAND_VALUE is a target a city can actually reach', () => {
    /** Perfect services, a park, no pollution or noise, crime as a mature city has it. */
    const MATURE_CRIME = 20;
    const perfectInlandCell = () => calculateLandValue({
      serviceCoverage: MAX_SERVICE_SCORE,
      parkProximity: true,
      waterfront: false,
      pollution: 0,
      noise: 0,
      crimeRate: MATURE_CRIME,
    });

    it('should be reachable by a city where every cell is perfect', () => {
      expect(perfectInlandCell()).toBeGreaterThan(EDUCATION_THRESHOLDS.AVG_LAND_VALUE);
    });

    it('should leave headroom, not sit right on the ceiling', () => {
      // A threshold one point under the perfect-city average would still be
      // unreachable in practice: no real city is uniformly perfect.
      expect(EDUCATION_THRESHOLDS.AVG_LAND_VALUE)
        .toBeLessThan(perfectInlandCell() * 0.95);
    });

    it('should not be cleared by a city with no services', () => {
      const bare = calculateLandValue({
        serviceCoverage: 0, parkProximity: false, waterfront: false,
        pollution: 0, noise: 0, crimeRate: MATURE_CRIME,
      });
      expect(bare).toBeLessThan(EDUCATION_THRESHOLDS.AVG_LAND_VALUE);
    });

    it('should not need a waterfront cell to be beaten', () => {
      expect(MAX_ORDINARY_LAND_VALUE).toBeGreaterThan(EDUCATION_THRESHOLDS.AVG_LAND_VALUE);
    });
  });

  it('CHILD_EDUCATION should have correct values', () => {
    expect(CHILD_EDUCATION.LATE_FRACTION).toBe(0.7);
    expect(CHILD_EDUCATION.EARLY_FRACTION).toBe(0.3);
    expect(CHILD_EDUCATION.LATE_GRADUATION_CHANCE).toBe(0.5);
    expect(CHILD_EDUCATION.EARLY_TEEN_NO_EDUCATION_CHANCE).toBe(0.4);
  });

  it('ATTRITION should have correct values', () => {
    expect(ATTRITION.GOOD_THRESHOLD).toBe(70);
    expect(ATTRITION.POOR_THRESHOLD).toBe(40);
  });
});

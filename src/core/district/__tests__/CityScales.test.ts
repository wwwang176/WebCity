import { describe, it, expect } from 'vitest';
import { computeCityScales, CLINIC_AGE_WEIGHT } from '../PolicyBilling';
import { CitizenManager } from '../../citizen/CitizenManager';
import { LifeStage, LIFE_STAGE_AGE } from '../../citizen/types';

/**
 * Billing scales are more than a single population figure.
 *
 * The childcare subsidy is paid to children and the free clinic sees patients. Billed by total
 * population, a city with no children pays the full childcare subsidy for money nobody receives.
 */

/** A representative age for each life stage. */
const AGE = {
  baby: 4,
  child: 20,
  teen: 40,
  adult: 100,
  senior: 220,
} as const;

const coveredEverywhere = () => true;

function managerWith(counts: Partial<Record<keyof typeof AGE, number>>): CitizenManager {
  const mgr = new CitizenManager();
  let i = 0;
  for (const [stage, n] of Object.entries(counts)) {
    for (let k = 0; k < (n ?? 0); k++) {
      mgr.restoreCitizen({ age: AGE[stage as keyof typeof AGE], homeId: `${i++},0` });
    }
  }
  return mgr;
}

describe('計費規模', () => {
  it('should count each life stage separately', () => {
    const s = computeCityScales(
      managerWith({ baby: 3, child: 5, teen: 7, adult: 11 }).getCitizens(), coveredEverywhere);
    expect(s.babies, '嬰兒數不對').toBe(3);
    expect(s.children, '兒童數不對').toBe(5);
    expect(s.teens, '青少年數不對').toBe(7);
    expect(s.population, '總人口不對').toBe(26);
  });

  it('should weight clinic patients by age', () => {
    // The old and the very young account for most healthcare spending; adults are cheap by
    // comparison.
    const seniors = computeCityScales(managerWith({ senior: 10 }).getCitizens(), coveredEverywhere);
    const adults = computeCityScales(managerWith({ adult: 10 }).getCitizens(), coveredEverywhere);
    expect(seniors.clinicPatients, '十個老人不比十個成人貴').toBeGreaterThan(adults.clinicPatients);
    expect(adults.clinicPatients, '成人的權重不是 1')
      .toBeCloseTo(10 * CLINIC_AGE_WEIGHT[LifeStage.ADULT], 6);
  });

  it('should count nobody the hospitals cannot reach', () => {
    // Where no hospital reaches, nobody attends and no subsidy is paid.
    const mgr = managerWith({ adult: 10 });
    const half = computeCityScales(mgr.getCitizens(), (x) => x < 5);
    expect(half.clinicPatients, '沒被醫院蓋到的人也被算進帳單')
      .toBeCloseTo(5 * CLINIC_AGE_WEIGHT[LifeStage.ADULT], 6);
    expect(half.population, '人口數不該被覆蓋範圍影響').toBe(10);
  });

  it('should count no patient for someone with no home at all', () => {
    // With no home there is no coordinate to check coverage against. Counting them charges for
    // nothing.
    const mgr = new CitizenManager();
    for (let i = 0; i < 10; i++) mgr.restoreCitizen({ age: AGE.adult, homeId: null });
    expect(computeCityScales(mgr.getCitizens(), coveredEverywhere).clinicPatients,
      '無家者被算進診所的帳單').toBe(0);
  });

  it('should agree with the life stage boundaries', () => {
    // The boundaries are read from LIFE_STAGE_AGE rather than written as literals: a change to
    // them has to reach here rather than silently counting a cohort of infants as children.
    const s = computeCityScales(
      managerWith({}).getCitizens(), coveredEverywhere);
    expect(s.babies + s.children + s.teens, '空城不該有小孩').toBe(0);
    const mgr = new CitizenManager();
    mgr.restoreCitizen({ age: LIFE_STAGE_AGE.BABY_MAX, homeId: '0,0' });
    mgr.restoreCitizen({ age: LIFE_STAGE_AGE.BABY_MAX + 1, homeId: '1,0' });
    const b = computeCityScales(mgr.getCitizens(), coveredEverywhere);
    expect(b.babies, 'BABY_MAX 那一格不是嬰兒').toBe(1);
    expect(b.children, 'BABY_MAX + 1 那一格不是兒童').toBe(1);
  });
});

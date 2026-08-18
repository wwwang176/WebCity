import { describe, it, expect } from 'vitest';
import { computeCityScales, CLINIC_AGE_WEIGHT } from '../PolicyBilling';
import { CitizenManager } from '../../citizen/CitizenManager';
import { LifeStage, LIFE_STAGE_AGE } from '../../citizen/types';

/**
 * 計費的規模不只有「人口」一個數字。
 *
 * 育兒補貼發給孩子、免費診所看的是病人 —— 按總人口收的話，一座沒有小孩的城市
 * 也要為育兒補貼付全額，而那筆錢沒有任何人領得到。
 */

/** 各生命階段的代表年齡。 */
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
    // 老人與嬰幼兒吃掉大部分的醫療支出，成人相對便宜。
    const seniors = computeCityScales(managerWith({ senior: 10 }).getCitizens(), coveredEverywhere);
    const adults = computeCityScales(managerWith({ adult: 10 }).getCitizens(), coveredEverywhere);
    expect(seniors.clinicPatients, '十個老人不比十個成人貴').toBeGreaterThan(adults.clinicPatients);
    expect(adults.clinicPatients, '成人的權重不是 1')
      .toBeCloseTo(10 * CLINIC_AGE_WEIGHT[LifeStage.ADULT], 6);
  });

  it('should count nobody the hospitals cannot reach', () => {
    // 使用者的觀察:醫院蓋不到的地方，人根本沒去看病 —— 補助也就沒發出去。
    const mgr = managerWith({ adult: 10 });
    const half = computeCityScales(mgr.getCitizens(), (x) => x < 5);
    expect(half.clinicPatients, '沒被醫院蓋到的人也被算進帳單')
      .toBeCloseTo(5 * CLINIC_AGE_WEIGHT[LifeStage.ADULT], 6);
    expect(half.population, '人口數不該被覆蓋範圍影響').toBe(10);
  });

  it('should count no patient for someone with no home at all', () => {
    // 沒有家就沒有座標可查，判不出他在不在覆蓋範圍內。算進去等於憑空收錢。
    const mgr = new CitizenManager();
    for (let i = 0; i < 10; i++) mgr.restoreCitizen({ age: AGE.adult, homeId: null });
    expect(computeCityScales(mgr.getCitizens(), coveredEverywhere).clinicPatients,
      '無家者被算進診所的帳單').toBe(0);
  });

  it('should agree with the life stage boundaries', () => {
    // 邊界直接讀 LIFE_STAGE_AGE，不寫死數字 —— 分界改了這裡要跟著改，而不是靜靜
    // 地把一批嬰兒算成兒童。
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

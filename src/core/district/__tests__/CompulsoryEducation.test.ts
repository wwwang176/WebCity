import { describe, it, expect, vi } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CitizenManager } from '../../citizen/CitizenManager';
import { EducationLevel } from '../../citizen/types';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 義務教育:國民教育辦到哪一階，那一階以下的學生就是全日、強制出席，進度推得
 * 比較快。辦得越高越貴。
 *
 * 三級不是四級 —— 遊戲的學制只有三階（國小、高中、大學），沒有獨立的國中。
 *
 * 量的是 `educationProgress` 的累積量，不是畢業人數:國小要 150 次 educateTick
 * 才畢得了業，而迴圈六個 tick 才跑一次，等一個畢業生要九百個 tick。
 */

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;

const UNLIMITED = { elementary: Infinity, highSchool: Infinity, university: Infinity };

/**
 * 一群學生跑一次 educateTick 之後的總進度。
 *
 * `education` 決定他站在學制的哪一階 —— NONE 在唸國小、ELEMENTARY 在唸高中、
 * HIGH_SCHOOL 在唸大學。
 */
function progressAfterOneTick(level: EducationLevel, stages: number): number {
  reseedRandom();
  const mgr = new CitizenManager();
  for (let i = 0; i < 200; i++) mgr.createCitizen({ age: 20, education: level, homeId: `${i},0` });
  mgr.educateTick(() => true, UNLIMITED, stages);
  let total = 0;
  for (const c of mgr.getCitizens()) total += c.educationProgress;
  return total;
}

/** 一座有國小、有電有水、住宅裡住著小孩的城市。 */
function cityProgress(policyLevel: number): number {
  reseedRandom();
  const state = createGameState(40, 40);
  for (let x = 1; x < 39; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 1; x < 39; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  // 設施要同時進格子與服務物件:供電的預算流量是照格子的 buildingId 算需求的，
  // 只登記在服務物件裡的學校沒有需求，永遠不會被判定為有電，也就永遠不營運。
  const put = (x: number, y: number, id: number) => {
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      state.grid.setCell(x + dx, y + dy, { buildingId: id });
    }
  };
  put(5, 8, 254);
  state.power.addPlant({ x: 5, y: 8, output: 1_000_000, pollution: 0, type: 'solar' });
  put(10, 8, 253);
  state.water.addPlant({ x: 10, y: 8, output: 1_000_000 });
  put(20, 8, 249);
  state.education.addSchool(20, 8, 'elementary', 40, 10000);

  const loop = new SimulationLoop(state);
  state.ordinances.setLevel(PolicyType.COMPULSORY_EDUCATION, policyLevel);
  for (let x = 1; x < 39; x++) state.citizens.restoreCitizen({ age: 20, homeId: `${x},11` });
  // 教育跑在 slowSlot 4，也就是每 6 tick 一次。24 tick = 四次。
  for (let i = 0; i < 24; i++) loop.tick();
  let total = 0;
  for (const c of state.citizens.getCitizens()) total += c.educationProgress;
  return total;
}

useSeededRandom();

describe('義務教育', () => {
  it('should push the compelled stage along faster', () => {
    // 抖動關掉:量的是條例本身，不是這一次擲出來的 80%~120%。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plain = progressAfterOneTick(EducationLevel.NONE, 0);
    expect(plain, '一點進度都沒有，這條測試等於空轉').toBeGreaterThan(0);
    expect(progressAfterOneTick(EducationLevel.NONE, 1), '義務到國小卻沒有加速國小')
      .toBeGreaterThan(plain);
  });

  it('should leave the stages above the mandate alone', () => {
    // 這是分級的全部意義。少了這條，三級可以全部一樣強，而價目表照樣逐級變貴。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const highSchoolPlain = progressAfterOneTick(EducationLevel.ELEMENTARY, 0);
    expect(progressAfterOneTick(EducationLevel.ELEMENTARY, 1),
      '義務只辦到國小，高中生卻也被加速了').toBe(highSchoolPlain);
    expect(progressAfterOneTick(EducationLevel.ELEMENTARY, 2), '義務辦到高中卻沒有加速高中')
      .toBeGreaterThan(highSchoolPlain);

    const universityPlain = progressAfterOneTick(EducationLevel.HIGH_SCHOOL, 0);
    expect(progressAfterOneTick(EducationLevel.HIGH_SCHOOL, 2),
      '義務只辦到高中，大學生卻也被加速了').toBe(universityPlain);
    expect(progressAfterOneTick(EducationLevel.HIGH_SCHOOL, 3), '義務辦到大學卻沒有加速大學')
      .toBeGreaterThan(universityPlain);
  });

  it('should compel nothing at all when it is off', () => {
    expect(new CityOrdinances().getCompulsorySchoolingStages(), '沒開條例卻compel了什麼')
      .toBe(0);
  });

  it('should reach one stage further at every tier', () => {
    const o = new CityOrdinances();
    const stagesAt = (lv: number) => {
      o.setLevel(PolicyType.COMPULSORY_EDUCATION, lv);
      return o.getCompulsorySchoolingStages();
    };
    expect(stagesAt(1), '第一級沒有辦到國小').toBe(1);
    expect(stagesAt(2), '第二級沒有辦到高中').toBe(2);
    expect(stagesAt(3), '第三級沒有辦到大學').toBe(3);
  });

  it('should reach the school through the simulation loop', () => {
    // 接線:少了這條，`getCompulsorySchoolingStages` 可以完全沒有人呼叫。
    const plain = cityProgress(0);
    expect(plain, '城裡沒有人在唸書，這條測試等於空轉').toBeGreaterThan(0);
    expect(cityProgress(1), '條例沒有走到教育那條線').toBeGreaterThan(plain);
  });

  it('should cost industry more the further it goes', () => {
    // 學歷拉高之後，願意進工廠的人變少 —— 代價落在工業，商業與住宅不動。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.COMPULSORY_EDUCATION, 1);
    const light = o.getRevenueMultiplier(ZoneType.INDUSTRIAL);
    o.setLevel(PolicyType.COMPULSORY_EDUCATION, 3);
    expect(light, '工業沒有付代價').toBeLessThan(1);
    expect(o.getRevenueMultiplier(ZoneType.INDUSTRIAL), '辦到大學卻沒有比辦到國小貴')
      .toBeLessThan(light);
    expect(o.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業也被扣了').toBe(1);
    expect(o.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
  });
});

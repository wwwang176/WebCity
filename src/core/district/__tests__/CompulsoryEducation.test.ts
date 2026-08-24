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
 * Compulsory education: students at or below the stage it reaches attend full time by law and
 * progress faster. The further it reaches, the more it costs.
 *
 * Three levels rather than four, because the game's system has three stages — primary, high
 * school, university — with no separate middle school.
 *
 * What is measured is accumulated `educationProgress` rather than graduations: primary school
 * takes 150 educateTicks to finish and the loop runs one tick in six, so a graduate is nine
 * hundred ticks away.
 */

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;

const UNLIMITED = { elementary: Infinity, highSchool: Infinity, university: Infinity };

/**
 * A group of students' total progress after one educateTick.
 *
 * `education` decides which stage they are at: NONE is in primary school, ELEMENTARY in high
 * school, HIGH_SCHOOL at university.
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

/** A city with a primary school, power and water, and children living in the housing. */
function cityProgress(policyLevel: number): number {
  reseedRandom();
  const state = createGameState(40, 40);
  for (let x = 1; x < 39; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 1; x < 39; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  // A facility goes into both the grid and the service object: the power budget flood computes
  // demand from a cell's buildingId, so a school registered only in the service object has no
  // demand, is never judged powered, and never operates.
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
  // Education runs in slow slot 4, once every 6 ticks, so 24 ticks is four passes.
  for (let i = 0; i < 24; i++) loop.tick();
  let total = 0;
  for (const c of state.citizens.getCitizens()) total += c.educationProgress;
  return total;
}

useSeededRandom();

describe('義務教育', () => {
  it('should push the compelled stage along faster', () => {
    // Jitter is switched off: what is measured is the ordinance, not this roll's 80-120%.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plain = progressAfterOneTick(EducationLevel.NONE, 0);
    expect(plain, '一點進度都沒有，這條測試等於空轉').toBeGreaterThan(0);
    expect(progressAfterOneTick(EducationLevel.NONE, 1), '義務到國小卻沒有加速國小')
      .toBeGreaterThan(plain);
  });

  it('should leave the stages above the mandate alone', () => {
    // The whole point of the levels. Without this, all three could be equally strong while the
    // price list still rises with each.
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
    // The wiring: without this, `getCompulsorySchoolingStages` could have no caller at all.
    const plain = cityProgress(0);
    expect(plain, '城裡沒有人在唸書，這條測試等於空轉').toBeGreaterThan(0);
    expect(cityProgress(1), '條例沒有走到教育那條線').toBeGreaterThan(plain);
  });

  it('should cost industry more the further it goes', () => {
    // With education raised, fewer people are willing to work in a factory: the cost falls on
    // industry and leaves commerce and housing alone.
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

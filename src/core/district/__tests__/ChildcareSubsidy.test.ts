import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CitizenManager } from '../../citizen/CitizenManager';
import { birthTick } from '../../citizen/Birth';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * The childcare subsidy: the treasury pays, and more children are born.
 *
 * What is measured is the newborn count `birthTick` returns, the only exit from the birth path.
 * Fertility itself is one roll per citizen, so the sample has to be large: 2,000 adults at
 * probabilities of 0.05 and 0.0775 differ by about 5.7 standard deviations, which no change of
 * seed will overturn.
 */

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;

const ADULTS = 2000;

/** One adult per household with no children and nobody else, so every roll actually happens. */
function birthsWithMultiplier(fertilityMultiplier: number): number {
  reseedRandom();
  const mgr = new CitizenManager();
  for (let i = 0; i < ADULTS; i++) {
    // Happiness is held below every education threshold so its bonus cannot mask the subsidy.
    mgr.createCitizen({ age: 100, homeId: `${i},0`, happiness: 40 });
  }
  return birthTick(mgr, { getResidents: () => 8, fertilityMultiplier });
}

/**
 * A city one tick short of a month boundary.
 *
 * Births run once a month, every 720 ticks. Running a whole month is too slow, so the clock is
 * wound to one tick before the end. `lastBirthMonth` is recorded in the constructor, so the loop
 * has to be built before the clock is wound.
 */
function cityAtMonthEnd(level: number): GameState {
  reseedRandom();
  const state = createGameState(40, 40);
  for (let x = 1; x < 39; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 1; x < 39; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
    state.grid.setCell(x, 9, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  const loop = new SimulationLoop(state);
  state.ordinances.setLevel(PolicyType.CHILDCARE_SUBSIDY, level);
  for (let x = 1; x < 39; x++) {
    // restoreCitizen bypasses the city-wide capacity gate: this is a fixture, not immigration.
    state.citizens.restoreCitizen({ age: 100, homeId: `${x},11`, happiness: 40 });
    state.citizens.restoreCitizen({ age: 100, homeId: `${x},9`, happiness: 40 });
  }
  state.clock.tick = 719;
  loop.tick();
  return state;
}

useSeededRandom();

describe('育兒補貼', () => {
  it('should raise the chance of a birth', () => {
    const plain = birthsWithMultiplier(1);
    expect(plain, '一個都沒生，這條測試等於空轉').toBeGreaterThan(0);
    expect(birthsWithMultiplier(1.55), '補貼沒有讓新生兒變多').toBeGreaterThan(plain);
  });

  it('should not change anything at all when it is off', () => {
    const o = new CityOrdinances();
    expect(o.getFertilityMultiplier(), '沒開條例卻不是原值 1').toBe(1);
  });

  it('should raise the multiplier further at every tier', () => {
    const o = new CityOrdinances();
    const at = (lv: number) => {
      o.setLevel(PolicyType.CHILDCARE_SUBSIDY, lv);
      return o.getFertilityMultiplier();
    };
    // Longer support makes households more willing: what decides whether to have a child is the
    // support expected across the whole dependent period, not this month's payment.
    expect(at(1), '補到嬰兒沒有提高生育率').toBeGreaterThan(1);
    expect(at(2), '補到兒童沒有比補到嬰兒更強').toBeGreaterThan(at(1));
    expect(at(3), '補到青少年沒有比補到兒童更強').toBeGreaterThan(at(2));
  });

  describe('費用跟著真正領到補貼的孩子走', () => {
    // The whole point of the levels. Billed by total population, supporting infants and
    // supporting adolescents cost the same and the player has no reason not to take the top
    // level immediately.
    const scale = {
      population: 1000, districtCells: 0, districtRoadCells: 0,
      babies: 40, children: 60, teens: 50, clinicPatients: 900, chargedDrivers: 0,
    };
    const costAt = (lv: number) => policyCost(PolicyType.CHILDCARE_SUBSIDY, lv, scale);

    it('should charge for babies only at the first tier', () => {
      const perHead = costAt(1) / scale.babies;
      expect(perHead, '第一級沒有收費').toBeGreaterThan(0);
      expect(costAt(2), '補到兒童卻沒有把兒童算進帳單')
        .toBeCloseTo(perHead * (scale.babies + scale.children), 6);
      expect(costAt(3), '補到青少年卻沒有把青少年算進帳單')
        .toBeCloseTo(perHead * (scale.babies + scale.children + scale.teens), 6);
    });

    it('should charge nothing in a city with no children at all', () => {
      // In a city with no children yet, nobody receives the money and nothing should be
      // charged.
      const childless = { ...scale, babies: 0, children: 0, teens: 0 };
      expect(policyCost(PolicyType.CHILDCARE_SUBSIDY, 3, childless),
        '沒有小孩卻還在收育兒補貼的錢').toBe(0);
    });

    it('should not follow the total population', () => {
      // Ten times the population with no more children must not move the bill: that is the
      // difference between paying per head and budgeting against population.
      expect(policyCost(PolicyType.CHILDCARE_SUBSIDY, 2, { ...scale, population: 10_000 }),
        '育兒補貼跟著總人口變動').toBe(costAt(2));
    });
  });

  it('should reach births through the simulation loop', () => {
    // The wiring: the ordinance's multiplier has to reach birthTick. Without this,
    // `getFertilityMultiplier` could have no caller at all and the three tests above stay green.
    const plain = cityAtMonthEnd(0).citizens.getPopulation();
    expect(plain, '跨月那一 tick 一個都沒生，這條測試等於空轉')
      .toBeGreaterThan(76);
    expect(cityAtMonthEnd(2).citizens.getPopulation(), '條例沒有走到出生那條線')
      .toBeGreaterThan(plain);
  });

  it('should be paid for by employers', () => {
    // Funded by a levy on employers, so the cost falls on commerce and industry and leaves
    // housing alone: the beneficiaries are the households.
    const o = new CityOrdinances();
    o.setLevel(PolicyType.CHILDCARE_SUBSIDY, 2);
    expect(o.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業沒有付代價').toBeLessThan(1);
    expect(o.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有付代價').toBeLessThan(1);
    expect(o.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
  });
});

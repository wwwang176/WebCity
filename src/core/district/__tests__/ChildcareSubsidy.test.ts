import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CitizenManager } from '../../citizen/CitizenManager';
import { birthTick } from '../../citizen/Birth';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 育兒補貼:市府出錢，孩子多生一點。
 *
 * 量的是 `birthTick` 回傳的新生兒數 —— 它是出生那條線唯一的出口。生育率本身是
 * 每個市民逐一擲骰子，所以樣本要夠大:2000 個成人在 0.05 與 0.0775 兩個機率下的
 * 差距約 5.7 個標準差，換一個種子也不會翻過來。
 */

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;

const ADULTS = 2000;

/** 每個成人一戶，戶內既沒有小孩也沒有別人 —— 讓每一次擲骰都真的擲得出來。 */
function birthsWithMultiplier(fertilityMultiplier: number): number {
  reseedRandom();
  const mgr = new CitizenManager();
  for (let i = 0; i < ADULTS; i++) {
    // happiness 壓在所有教育程度的門檻之下，免得幸福加成把補貼的效果蓋掉。
    mgr.createCitizen({ age: 100, homeId: `${i},0`, happiness: 40 });
  }
  return birthTick(mgr, { getResidents: () => 8, fertilityMultiplier });
}

/**
 * 一座剛好要跨月的城市。
 *
 * 出生一個月才跑一次（720 tick）。整整跑一個月太慢，所以把時鐘直接撥到月底前一
 * tick —— `lastBirthMonth` 在建構子裡就記下來了，所以 loop 必須先建好再撥。
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
    // restoreCitizen 繞過全城容量閘門 —— 這是 fixture，不是模擬中的遷入。
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

  it('should raise the multiplier further at the higher tier', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.CHILDCARE_SUBSIDY, 1);
    const light = o.getFertilityMultiplier();
    o.setLevel(PolicyType.CHILDCARE_SUBSIDY, 2);
    expect(light, '第一級沒有提高生育率').toBeGreaterThan(1);
    expect(o.getFertilityMultiplier(), '第二級沒有比第一級更強').toBeGreaterThan(light);
  });

  it('should reach births through the simulation loop', () => {
    // 接線:條例的乘數要真的走到 birthTick。少了這條，`getFertilityMultiplier`
    // 可以完全沒有人呼叫，而上面三條照樣全綠。
    const plain = cityAtMonthEnd(0).citizens.getPopulation();
    expect(plain, '跨月那一 tick 一個都沒生，這條測試等於空轉')
      .toBeGreaterThan(76);
    expect(cityAtMonthEnd(2).citizens.getPopulation(), '條例沒有走到出生那條線')
      .toBeGreaterThan(plain);
  });

  it('should be paid for by employers', () => {
    // 財源是雇主的育兒基金，所以代價落在商業與工業，住宅不動 —— 受益的是家戶。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.CHILDCARE_SUBSIDY, 2);
    expect(o.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業沒有付代價').toBeLessThan(1);
    expect(o.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有付代價').toBeLessThan(1);
    expect(o.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
  });
});

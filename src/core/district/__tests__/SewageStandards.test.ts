import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * Sewage treatment standards: factories and households discharge less, so the treatment plant
 * lasts longer.
 *
 * What is measured is `SewageService.getProduced()`, the exit from the `produceGarbageAndSewage`
 * path. Figures such as `getDemand()` are computed separately, and multiplying there affects no
 * cell.
 */

/** Small Shop (COMMERCIAL_LOW). */
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // The A and B cities have to start from the same random state. Without a reset the second
  // continues the sequence the first left behind, the two cities diverge on their own, and what
  // is measured is that divergence rather than the ordinance.
  reseedRandom();
  // A larger city: `getProduced()` floors to a whole number, and at small volumes a 15% and a
  // 30% reduction land on the same figure.
  const state = createGameState(60, 60);
  for (let x = 2; x < 58; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 2; x < 58; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
  }
  return { state, loop: new SimulationLoop(state) };
}

const producedWith = (level: number) => {
  const { state, loop } = city();
  state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, level);
  // Sewage production runs in slow slot 2, once every 6 ticks.
  for (let i = 0; i < 12; i++) loop.tick();
  return state.sewage.getProduced();
};

// The whole file is seeded: every test compares two cities, and building growth, layoffs and
// vehicle jitter all roll dice inside a tick. The sequence is reset again when each city is
// built, so A and B start from the same point.
useSeededRandom();

describe('汙水處理標準', () => {
  it('should cut how much sewage the city puts out', () => {
    const plain = producedWith(0);
    expect(plain, '沒有汙水可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(producedWith(1), '第一級沒有減少汙水').toBeLessThan(plain);
    expect(producedWith(2), '第二級沒有比第一級更少').toBeLessThan(producedWith(1));
  });

  it('should leave less of it untreated', () => {
    // With the plant's capacity unchanged and discharge lower, less goes untreated, which is
    // what the player is actually buying.
    const untreatedWith = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, level);
      for (let i = 0; i < 12; i++) loop.tick();
      return state.sewage.getUntreated();
    };
    const plain = untreatedWith(0);
    expect(plain, '本來就沒有未處理的汙水，量不出改善').toBeGreaterThan(0);
    expect(untreatedWith(2), '未處理的汙水沒有變少').toBeLessThan(plain);
  });

  it('should be paid for by industry', () => {
    // Process discharge standards act on factories and leave housing and commerce alone.
    const { state } = city();
    state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, 2);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有付代價')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業也被扣了')
      .toBe(1);
  });
});

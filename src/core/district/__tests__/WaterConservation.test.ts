import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

/**
 * Water conservation has to save real water.
 *
 * Lowering the headline `getDemand()` is easy, but which buildings have water is decided by
 * `calculateCoverage`'s budgeted BFS, which asks `getCellDemandAt`. Lowering only the former
 * improves `getSupplyRatio()` while not a single dry building regains supply, and supply is what
 * the player is buying.
 */

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;
/** Enough for 19 of the 36 houses: the BFS runs out of budget partway, which is what is being
 *  measured. */
const PLANT_OUTPUT = 10;

/** A city short of water: the plant's output is far below total demand, so the BFS runs out of
 *  budget partway. */
function thirstyCity(): { state: GameState; loop: SimulationLoop } {
  const state = createGameState(40, 40);
  for (let x = 2; x < 38; x++) state.grid.setCell(x, 20, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 2; x < 38; x++) {
    state.grid.setCell(x, 21, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  state.water.addPlant({ x: 2, y: 19, output: PLANT_OUTPUT });
  return { state, loop: new SimulationLoop(state) };
}

function suppliedCount(state: GameState): number {
  let n = 0;
  state.grid.forEachCell((cell, x, y) => {
    if (cell.buildingId === HOUSE && state.water.isSupplied(x, y)) n++;
  });
  return n;
}

describe('節水法規', () => {
  it('should get water to buildings that had none', () => {
    const run = (level: number) => {
      const { state, loop } = thirstyCity();
      state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, level);
      loop.recalculateUtilityCoverage();
      return { supplied: suppliedCount(state), demand: state.water.getDemand() };
    };
    const plain = run(0);
    const saving = run(3);
    expect(plain.supplied, '一棟都沒供到水，量不出改善').toBeGreaterThan(0);
    expect(plain.supplied, '水本來就夠用，這條測試等於空轉')
      .toBeLessThan(36);
    expect(saving.supplied, '節水法規沒有讓更多建築喝到水')
      .toBeGreaterThan(plain.supplied);
    // The headline figure is only supporting evidence: it falling does not mean the BFS sees it.
    expect(saving.demand, '總需求沒有下降').toBeLessThan(plain.demand);
  });

  it('should cost commerce and industry, and get steeper each tier', () => {
    const { state } = thirstyCity();
    const demandAt = (level: number) => {
      state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, level);
      state.water.calculateDemand(state.grid, state.ordinances.getWaterDemandMultiplier());
      return state.water.getDemand();
    };
    const [d0, d1, d2, d3] = [demandAt(0), demandAt(1), demandAt(2), demandAt(3)];
    expect(d1, '第一級沒有省水').toBeLessThan(d0!);
    expect(d2, '第二級沒有比第一級省').toBeLessThan(d1!);
    expect(d3, '第三級沒有比第二級省').toBeLessThan(d2!);

    state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, 3);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有付代價')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業沒有付代價')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
    // Industry is charged more heavily than commerce: re-engineering process water costs far more
    // than fitting low-flow taps.
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業與商業扣得一樣多')
      .toBeLessThan(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW));
  });
});

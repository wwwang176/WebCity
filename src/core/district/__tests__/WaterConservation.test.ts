import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

/**
 * 節水法規要真的省下水。
 *
 * 帳面上的 `getDemand()` 變小很容易 —— 但決定哪些建築有水的是 `calculateCoverage`
 * 的預算式 BFS，它問的是 `getCellDemandAt`。只降前者的話，`getSupplyRatio()` 看起來
 * 改善了，缺水的建築卻一棟也不會恢復供水，而玩家買的正是那個。
 */

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;
/** 只夠供到 36 棟裡的 19 棟 —— BFS 會在半路耗盡預算，那正是要量的地方。 */
const PLANT_OUTPUT = 10;

/** 一座水不夠用的城市:水廠的產量遠低於總需求，所以 BFS 會在半路耗盡預算。 */
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
    // 帳面數字只是輔助 —— 它自己變小不代表 BFS 也看得到。
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
    // 工業扣得比商業重 —— 製程用水改造比換一批省水龍頭貴得多。
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業與商業扣得一樣多')
      .toBeLessThan(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW));
  });
});

import { describe, it, expect } from 'vitest';
import { commuteSliceCount, CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_MAX } from '../CitizenSlicing';
import { SIMULATION } from '../SimulationConstants';

/**
 * 通勤統計的片數。
 *
 * 跟快樂度共用同一個形狀，差別只有**下限**:快樂度原本的節奏是 6 個 tick，通勤是
 * 60。下限取各自原本的節奏，分片才不會讓資料比改動前更舊。
 *
 * `2100 × 60 = 126 000` —— 12.6 萬人以下算出來一律是 60，**每位市民的更新頻率與
 * 改動前完全相同**。動態的部分要到那之上才開始起作用。
 */
describe('commuteSliceCount', () => {
  it('should keep the pre-change refresh rate for any realistic city', () => {
    for (const pop of [0, 1, 1000, 12_400, 50_000, 100_000, CITIZEN_SLICE_PER_TICK * 60]) {
      expect(commuteSliceCount(pop), `人口 ${pop}`).toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
    }
  });

  it('should grow past that only when a tick would otherwise blow the budget', () => {
    // 超過 126 000 之後才長 —— 長的理由是每個 tick 的工作量要保持常數。
    const justOver = CITIZEN_SLICE_PER_TICK * 61;
    expect(commuteSliceCount(justOver)).toBe(61);
    expect(commuteSliceCount(CITIZEN_SLICE_PER_TICK * 70)).toBe(70);
  });

  it('should stop growing at the shared ceiling', () => {
    // 沒有上限的話 100 萬人要 476 個 tick 才輪完一圈，通勤圖層會舊到沒有意義。
    expect(commuteSliceCount(1_000_000)).toBe(CITIZEN_SLICE_MAX);
    expect(commuteSliceCount(Number.MAX_SAFE_INTEGER)).toBe(CITIZEN_SLICE_MAX);
  });

  it('should never return something SliceCycle cannot use', () => {
    for (const pop of [-1, 0, NaN, Infinity]) {
      const n = commuteSliceCount(pop);
      expect(Number.isInteger(n), `人口 ${pop} 給出 ${n}`).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });
});

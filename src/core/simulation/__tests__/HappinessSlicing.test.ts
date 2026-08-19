import { describe, it, expect } from 'vitest';
import {
  happinessSliceCount, happinessSliceOf,
  HAPPINESS_PER_TICK, HAPPINESS_MAX_SLICES,
} from '../HappinessSlicing';
import { SIMULATION } from '../SimulationConstants';

/**
 * `updateCitizenHappiness` 原本在慢速槽 4 裡把每一位市民重算一次。70 891 人實測那一發
 * 是 **68.5ms**，而速度 1 的一個 tick 只有 250ms —— 每 1.5 秒卡一下（BUG-330）。
 *
 * 分片之後每個 tick 只算一片。這是輪流不是抽樣:每位市民身上都存著自己的快樂度，
 * 沒輪到的人沿用上次的值，全城平均照樣是全體平均。
 */

const MIN = SIMULATION.SLOW_TICK_INTERVAL;

describe('要分成幾片', () => {
  it('should leave a small city on exactly the cadence it had', () => {
    // 小城市行為必須完全不變 —— 每位市民仍然每 6 個 tick 更新一次。
    for (const pop of [0, 1, 500, HAPPINESS_PER_TICK, HAPPINESS_PER_TICK * MIN]) {
      expect(happinessSliceCount(pop), `${pop} 人的城市被改了節奏`).toBe(MIN);
    }
  });

  it('should hold the work per tick flat as the city grows', () => {
    // 這是整件事的重點。片數不跟著長的話，每個 tick 的成本會跟人口一起線性爆炸。
    for (const pop of [20_000, 50_000, 100_000, 150_000]) {
      const perTick = pop / happinessSliceCount(pop);
      expect(perTick, `${pop} 人時每個 tick 要算 ${perTick.toFixed(0)} 位`)
        .toBeLessThanOrEqual(HAPPINESS_PER_TICK);
    }
  });

  it('should stop stretching at three game days', () => {
    // 沒有上限的話 100 萬人要 476 個 tick（20 個遊戲日）才輪完一圈。
    for (const pop of [300_000, 1_000_000, 10_000_000]) {
      expect(happinessSliceCount(pop), `${pop} 人沒有被上限擋住`).toBe(HAPPINESS_MAX_SLICES);
    }
  });

  it('should never go down as the city grows', () => {
    // 非單調的話，城市長大反而讓某個規模突然變慢 —— 沒有人預期得到。
    let prev = 0;
    for (let pop = 1; pop < 400_000; pop = Math.ceil(pop * 1.25)) {
      const n = happinessSliceCount(pop);
      expect(n, `${pop} 人的片數比更小的城市還少`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('should keep the reference city on six slices', () => {
    // 玩家的存檔 12 380 人。這個數字換了就不再是「行為完全不變」。
    expect(happinessSliceCount(12_380)).toBe(MIN);
    // 再多一點就該開始拉長了。
    expect(happinessSliceCount(HAPPINESS_PER_TICK * MIN + 1)).toBeGreaterThan(MIN);
  });
});

describe('誰屬於哪一片', () => {
  it('should put every citizen in exactly one slice', () => {
    for (const n of [6, 24, 72]) {
      for (let id = 1; id < 200; id++) {
        const s = happinessSliceOf(id, n);
        expect(Number.isInteger(s), `id=${id} 的片號不是整數`).toBe(true);
        expect(s, `id=${id} 的片號 ${s} 落在 0..${n - 1} 之外`).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(n);
      }
    }
  });

  it('should split the city into slices of roughly equal size', () => {
    // 大小差很多的話，成本就不是「每個 tick 固定」，而是某幾個 tick 特別重。
    const N = 24, POP = 60_000;
    const counts = new Array(N).fill(0);
    for (let id = 1; id <= POP; id++) counts[happinessSliceOf(id, N)]!++;
    const ideal = POP / N;
    for (let s = 0; s < N; s++) {
      expect(Math.abs(counts[s]! - ideal) / ideal, `第 ${s} 片大小偏離 ${counts[s]}`)
        .toBeLessThan(0.1);
    }
  });

  it('should scatter neighbours across different slices', () => {
    // id 相鄰的市民往往是同時建城、住同一區的。照名單位置切的話每一片會是一個街區，
    // 出事時反應會一區一區掃過去。雜湊之後才是全城橫切面。
    const N = 6;
    const seen = new Set<number>();
    for (let id = 1000; id < 1000 + N; id++) seen.add(happinessSliceOf(id, N));
    expect(seen.size, `連續 ${N} 個 id 只落在 ${seen.size} 片裡 —— 沒有打散`)
      .toBeGreaterThanOrEqual(N - 1);
  });

  it('should always give the same citizen the same slice', () => {
    // 每次算出不同片的話，有人會連續好幾圈都輪不到，落後時間就沒有上界了。
    for (const id of [1, 7, 12345, 999999]) {
      expect(happinessSliceOf(id, 24)).toBe(happinessSliceOf(id, 24));
    }
  });
});

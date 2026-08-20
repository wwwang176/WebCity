import { describe, it, expect } from 'vitest';
import {
  citizenSliceCount, citizenSliceOf, SliceCycle,
  CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_MAX,
} from '../CitizenSlicing';
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
    for (const pop of [0, 1, 500, CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_PER_TICK * MIN]) {
      expect(citizenSliceCount(pop), `${pop} 人的城市被改了節奏`).toBe(MIN);
    }
  });

  it('should hold the work per tick flat as the city grows', () => {
    // 這是整件事的重點。片數不跟著長的話，每個 tick 的成本會跟人口一起線性爆炸。
    for (const pop of [20_000, 50_000, 100_000, 150_000]) {
      const perTick = pop / citizenSliceCount(pop);
      expect(perTick, `${pop} 人時每個 tick 要算 ${perTick.toFixed(0)} 位`)
        .toBeLessThanOrEqual(CITIZEN_SLICE_PER_TICK);
    }
  });

  it('should stop stretching at three game days', () => {
    // 沒有上限的話 100 萬人要 476 個 tick（20 個遊戲日）才輪完一圈。
    for (const pop of [300_000, 1_000_000, 10_000_000]) {
      expect(citizenSliceCount(pop), `${pop} 人沒有被上限擋住`).toBe(CITIZEN_SLICE_MAX);
    }
  });

  it('should never go down as the city grows', () => {
    // 非單調的話，城市長大反而讓某個規模突然變慢 —— 沒有人預期得到。
    let prev = 0;
    for (let pop = 1; pop < 400_000; pop = Math.ceil(pop * 1.25)) {
      const n = citizenSliceCount(pop);
      expect(n, `${pop} 人的片數比更小的城市還少`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('should keep the reference city on six slices', () => {
    // 玩家的存檔 12 380 人。這個數字換了就不再是「行為完全不變」。
    expect(citizenSliceCount(12_380)).toBe(MIN);
    // 再多一點就該開始拉長了。
    expect(citizenSliceCount(CITIZEN_SLICE_PER_TICK * MIN + 1)).toBeGreaterThan(MIN);
  });
});

describe('誰屬於哪一片', () => {
  it('should put every citizen in exactly one slice', () => {
    for (const n of [6, 24, 72]) {
      for (let id = 1; id < 200; id++) {
        const s = citizenSliceOf(id, n);
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
    for (let id = 1; id <= POP; id++) counts[citizenSliceOf(id, N)]!++;
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
    for (let id = 1000; id < 1000 + N; id++) seen.add(citizenSliceOf(id, N));
    expect(seen.size, `連續 ${N} 個 id 只落在 ${seen.size} 片裡 —— 沒有打散`)
      .toBeGreaterThanOrEqual(N - 1);
  });

  it('should depend only on its arguments, with no hidden state', () => {
    // 擋的是「實作裡藏一個游標」那種寫法 —— 同樣的輸入連續兩次算出不同答案的話，
    // 分片就成了亂數抽樣，誰也保證不了會不會被跳過。
    //
    // 注意這裡**不**保證「一輪剛好一次」:片數變了每個人的片號就會跟著變。那個
    // 保證是在 SimulationLoop 用輪次游標做的，釘在 HappinessSliceFairness。
    for (const id of [1, 7, 12345, 999999]) {
      const first = citizenSliceOf(id, 24);
      // 中間插進一堆別的呼叫，藏了狀態的話會被推走。
      for (let other = 0; other < 50; other++) citizenSliceOf(other, 13);
      expect(citizenSliceOf(id, 24)).toBe(first);
    }
  });
});

describe('輪次游標', () => {
  it('should walk 0..N-1 and only re-evaluate the count at a boundary', () => {
    // 中途換片數就是所有人重新分片:已經輪過的人可能又被排到後面，還沒輪到的人
    // 可能被排到走過的片。
    const cycle = new SliceCycle();
    let want = 6;
    const seen: number[] = [];
    for (let t = 0; t < 6; t++) {
      want = 20;   // 每個 tick 都想換片數
      seen.push(cycle.next(() => want).index);
    }
    expect(seen, '一輪之內換了片數').toEqual([0, 1, 2, 3, 4, 5]);
    expect(cycle.next(() => want).slices, '新的一輪沒有換上新片數').toBe(20);
  });

  it('should start a fresh cycle after reset', () => {
    const cycle = new SliceCycle();
    cycle.next(() => 10);
    cycle.next(() => 10);
    cycle.reset();
    const { slices, index } = cycle.next(() => 7);
    expect(index, 'reset 之後沒有從第 0 片開始').toBe(0);
    expect(slices).toBe(7);
  });

  it('should refuse a slice count below one', () => {
    // 0 會讓 citizenSliceOf 取模得到 NaN —— 一個人都不會被更新，而且游標永遠
    // 到不了下一輪。負數會讓每次呼叫都重新開輪。
    for (const bad of [0, -3, NaN, 0.4]) {
      const cycle = new SliceCycle();
      const { slices, index } = cycle.next(() => bad);
      expect(slices, `countFor 回傳 ${bad} 時片數是 ${slices}`).toBeGreaterThanOrEqual(1);
      expect(Number.isNaN(citizenSliceOf(7, slices)), `片數 ${slices} 讓分片變成 NaN`).toBe(false);
      expect(index).toBe(0);
    }
  });
});

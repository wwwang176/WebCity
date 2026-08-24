import { describe, it, expect } from 'vitest';
import {
  citizenSliceCount, citizenSliceOf, SliceCycle,
  CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_MAX,
} from '../CitizenSlicing';
import { SIMULATION } from '../SimulationConstants';

/**
 * Recomputing every citizen in slow slot 4 measured **68.5ms** at 70,891 citizens, against
 * 250ms available per tick at speed 1 — a stutter every 1.5 seconds (BUG-330).
 *
 * Sliced, each tick computes one slice. This is round-robin, not sampling: each citizen
 * stores their own happiness, those not due keep their previous value, and the city-wide
 * average is still an average over everyone.
 */

const MIN = SIMULATION.SLOW_TICK_INTERVAL;

describe('要分成幾片', () => {
  it('should leave a small city on exactly the cadence it had', () => {
    // A small city's behaviour must be unchanged: each citizen still updates every 6 ticks.
    for (const pop of [0, 1, 500, CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_PER_TICK * MIN]) {
      expect(citizenSliceCount(pop), `${pop} 人的城市被改了節奏`).toBe(MIN);
    }
  });

  it('should hold the work per tick flat as the city grows', () => {
    // The point of the whole thing. Without the slice count growing, per-tick cost grows
    // linearly with population.
    for (const pop of [20_000, 50_000, 100_000, 150_000]) {
      const perTick = pop / citizenSliceCount(pop);
      expect(perTick, `${pop} 人時每個 tick 要算 ${perTick.toFixed(0)} 位`)
        .toBeLessThanOrEqual(CITIZEN_SLICE_PER_TICK);
    }
  });

  it('should stop stretching at three game days', () => {
    // Uncapped, a million citizens would need 476 ticks (20 game days) per cycle.
    for (const pop of [300_000, 1_000_000, 10_000_000]) {
      expect(citizenSliceCount(pop), `${pop} 人沒有被上限擋住`).toBe(CITIZEN_SLICE_MAX);
    }
  });

  it('should never go down as the city grows', () => {
    // Non-monotonic behaviour would make some city size suddenly slower as it grows, which
    // nobody would expect.
    let prev = 0;
    for (let pop = 1; pop < 400_000; pop = Math.ceil(pop * 1.25)) {
      const n = citizenSliceCount(pop);
      expect(n, `${pop} 人的片數比更小的城市還少`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('should keep the reference city on six slices', () => {
    // The reference save has 12,380 citizens. A different answer here means behaviour is no
    // longer unchanged.
    expect(citizenSliceCount(12_380)).toBe(MIN);
    // A little larger and it should start stretching.
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
    // Uneven slices make the cost peaky on certain ticks rather than flat per tick.
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
    // Citizens with adjacent ids were usually created at the same time and live in the same
    // area. Splitting by list position makes each slice a city block, so any reaction sweeps
    // the city block by block; hashing makes each slice a cross-section.
    const N = 6;
    const seen = new Set<number>();
    for (let id = 1000; id < 1000 + N; id++) seen.add(citizenSliceOf(id, N));
    expect(seen.size, `連續 ${N} 個 id 只落在 ${seen.size} 片裡 —— 沒有打散`)
      .toBeGreaterThanOrEqual(N - 1);
  });

  it('should depend only on its arguments, with no hidden state', () => {
    // Guards against hiding a cursor inside the implementation: if the same input gives
    // different answers on consecutive calls, slicing becomes random sampling and nothing
    // guarantees anyone is not skipped.
    //
    // Note this does **not** guarantee "exactly once per cycle": a changed slice count changes
    // everyone's index. That guarantee lives in SimulationLoop's cycle cursor and is pinned by
    // HappinessSliceFairness.
    for (const id of [1, 7, 12345, 999999]) {
      const first = citizenSliceOf(id, 24);
      // Interleave other calls: hidden state would be advanced by them.
      for (let other = 0; other < 50; other++) citizenSliceOf(other, 13);
      expect(citizenSliceOf(id, 24)).toBe(first);
    }
  });
});

describe('輪次游標', () => {
  it('should walk 0..N-1 and only re-evaluate the count at a boundary', () => {
    // Changing the count mid-cycle reassigns everyone: citizens already processed can land in
    // a later slice, and citizens not yet processed can land in one already passed.
    const cycle = new SliceCycle();
    let want = 6;
    // Start a real six-slice cycle first. Changing `want` before the first call would make
    // the cycle 20 slices from the outset, and "never changes mid-cycle" and "changes every
    // call" would produce the same result, testing nothing.
    expect(cycle.next(() => want).slices, '第一輪沒有用開輪時的片數').toBe(6);

    const seen = [0];
    want = 20;   // from the second tick on, every call wants a different count
    for (let t = 1; t < 6; t++) seen.push(cycle.next(() => want).index);
    expect(seen, '一輪之內換了片數').toEqual([0, 1, 2, 3, 4, 5]);

    const next = cycle.next(() => want);
    expect(next.slices, '新的一輪沒有換上新片數').toBe(20);
    expect(next.index, '換片數的那一次不是從第 0 片開始').toBe(0);
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
    // 0 makes citizenSliceOf's modulo return NaN: nobody is updated and the cursor never
    // reaches the next cycle. A negative count restarts the cycle on every call.
    // Infinity must be rejected too: the modulo stays a number, but `cursor >= slices` is
    // never true, so a cycle never ends and almost every tick computes nobody.
    for (const bad of [0, -3, NaN, 0.4, Infinity, -Infinity]) {
      const cycle = new SliceCycle();
      const { slices, index } = cycle.next(() => bad);
      expect(Number.isFinite(slices), `countFor 回傳 ${bad} 時片數是 ${slices}`).toBe(true);
      expect(slices).toBeGreaterThanOrEqual(1);
      expect(Number.isNaN(citizenSliceOf(7, slices)), `片數 ${slices} 讓分片變成 NaN`).toBe(false);
      expect(index).toBe(0);
    }
  });
});

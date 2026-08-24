import { describe, it, expect } from 'vitest';
import { commuteSliceCount, CITIZEN_SLICE_PER_TICK, CITIZEN_SLICE_MAX } from '../CitizenSlicing';
import { SIMULATION } from '../SimulationConstants';

/**
 * The slice count for the commute statistics.
 *
 * The same shape as happiness, differing only in the **floor**: happiness ran on a 6-tick
 * cadence and commuting on 60. Taking each one's original cadence as the floor keeps slicing
 * from making the data any staler than before.
 *
 * `2100 * 60 = 126,000`, so anything below 126,000 citizens comes out as 60 and **each
 * citizen updates exactly as often as before**. The dynamic part only takes effect above that.
 */
describe('commuteSliceCount', () => {
  it('should keep the pre-change refresh rate for any realistic city', () => {
    for (const pop of [0, 1, 1000, 12_400, 50_000, 100_000, CITIZEN_SLICE_PER_TICK * 60]) {
      expect(commuteSliceCount(pop), `人口 ${pop}`).toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
    }
  });

  it('should grow past that only when a tick would otherwise blow the budget', () => {
    // Growth starts above 126,000, in order to keep the per-tick work constant.
    const justOver = CITIZEN_SLICE_PER_TICK * 61;
    expect(commuteSliceCount(justOver)).toBe(61);
    expect(commuteSliceCount(CITIZEN_SLICE_PER_TICK * 70)).toBe(70);
  });

  it('should stop growing at the shared ceiling', () => {
    // Uncapped, a million citizens would need 476 ticks per cycle and the commute overlay
    // would be too stale to mean anything.
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

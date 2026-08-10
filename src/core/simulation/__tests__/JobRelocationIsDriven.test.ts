import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { SIMULATION } from '../SimulationConstants';
import type { JobRelocationSlicer } from '../../citizen/JobRelocation';

/**
 * 換工作那一輪是切片跑的，所以它需要有人**每個 tick** 推一下。
 *
 * 這一條擋的是那一行被刪掉：切片器只在 `JOB_RELOCATION_INTERVAL` 那個 tick
 * 被建立，之後如果沒有人呼叫 `advanceJobRelocation()`，整輪就停在原地，
 * **換工作會完全靜默地停擺**。
 *
 * 而且沒有任何既有測試會轉紅 —— 拿掉那一行時 562 條全過。這正是切片化引入的
 * 新失敗模式：以前那一輪是「一個 tick 裡跑完」，刪掉呼叫就等於刪掉整個功能，
 * 至少會有東西壞掉；現在它會安靜地半途而廢。
 */

/** 記錄自己被推了幾次的假切片器。 */
function fakeSlicer(steps: number): JobRelocationSlicer & { calls: number[] } {
  let left = steps;
  const calls: number[] = [];
  return {
    calls,
    get pending() { return left; },
    runSlice(budget: number): number[] {
      calls.push(budget);
      left = Math.max(0, left - 1);
      return [];
    },
  };
}

type Internals = { jobRelocationSlicer: JobRelocationSlicer | null };

function loopWithSlicer(steps: number) {
  const state = createGameState(8, 8);
  const loop = new SimulationLoop(state);
  const slicer = fakeSlicer(steps);
  (loop as unknown as Internals).jobRelocationSlicer = slicer;
  return { state, loop, slicer, internals: loop as unknown as Internals };
}

describe('the loop drives job relocation every tick', () => {
  it('should advance the slicer on a plain tick', () => {
    const { loop, slicer } = loopWithSlicer(5);
    loop.tick();
    expect(slicer.calls.length, '沒有人推進切片器，整輪停在原地').toBe(1);
  });

  it('should hand it the configured slice budget, not an unbounded one', () => {
    // 預算就是止痛的全部 —— 餵 Infinity 等於回到「一個 tick 跑完整輪」。
    const { loop, slicer } = loopWithSlicer(5);
    loop.tick();
    expect(slicer.calls[0]).toBe(SIMULATION.JOB_RELOCATION_SLICE);
  });

  it('should keep advancing across ticks until the sweep is done', () => {
    const { loop, slicer, internals } = loopWithSlicer(3);
    for (let i = 0; i < 3; i++) loop.tick();
    expect(slicer.pending, '這一輪沒有跑完').toBe(0);
    expect(internals.jobRelocationSlicer, '跑完之後沒有放掉切片器').toBeNull();
  });

  it('should not touch a finished slicer again', () => {
    // 放掉之後還繼續推，`runJobRelocation` 就永遠開不了新的一輪。
    const { loop, slicer } = loopWithSlicer(1);
    loop.tick();
    loop.tick();
    loop.tick();
    expect(slicer.calls.length, '跑完之後還在推同一個切片器').toBe(1);
  });
});

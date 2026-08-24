import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { GarbageService } from '../../service/GarbageService';
import { DeathCareService } from '../../service/DeathCareService';

/**
 * Happiness needs to know how many garbage bags and bodies are at a citizen's door, and that
 * per-cell table is counted from two pending queues.
 *
 * Counting from scratch every tick measured, on a 40k-citizen save, **24,547 pending bags
 * spread over 311 cells**, while the queues only change on a service tick (every 6), on the
 * daily deaths, and when the player demolishes a building — so five ticks in six produce an
 * identical count. That pass took 63.5% of `updateCitizenHappinessSlice` and 4.9% of the main
 * thread.
 *
 * The count is now taken only when a queue reports a change. **What these pin is that
 * report**: one test per entry point, because missing any one delays garbage at the door
 * reaching happiness by several ticks, and does so silently.
 */

type Inner = {
  refreshPendingCounts(): void;
  pendingGarbageCounts: Map<string, number>;
  pendingDeathCounts: Map<string, number>;
};

function makeLoop(): { state: GameState; inner: Inner } {
  const state = createGameState(16, 16);
  const loop = new SimulationLoop(state);
  return { state, inner: loop as unknown as Inner };
}

describe('門口的垃圾與屍體要跟著佇列走', () => {
  it('should be empty before anything happened', () => {
    const { inner } = makeLoop();
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.size).toBe(0);
    expect(inner.pendingDeathCounts.size).toBe(0);
  });

  it('should see garbage as soon as it is reported', () => {
    // Count once first so there is something to reuse. Reporting and then counting would hit
    // the first-call recount anyway, hiding whether the change was recorded.
    const { state, inner } = makeLoop();
    inner.refreshPendingCounts();

    state.garbage.reportGarbage(3, 4, 2);   // 2 bags
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4')).toBe(2);
  });

  it('should not count a part-filled bag', () => {
    // Less than a full bag has not entered the queue and is not garbage at the door.
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 0.4);
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4')).toBeUndefined();
  });

  it('should see a death as soon as it is reported', () => {
    const { state, inner } = makeLoop();
    inner.refreshPendingCounts();   // as above: a cache has to exist first

    state.deathCare.reportDeath(5, 6);
    state.deathCare.reportDeath(5, 6);
    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6')).toBe(2);
  });

  it('should forget garbage cleared by a demolish', () => {
    // `clearPendingAt` is the path taken when the player demolishes a building and is **on no
    // schedule at all**, so using the schedule as the change signal misses it.
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 2);
    inner.refreshPendingCounts();
    expect(inner.pendingGarbageCounts.get('3,4'), '前置條件:要先數到').toBe(2);

    state.garbage.clearPendingAt(3, 4);
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '拆掉了門口卻還記著垃圾').toBeUndefined();
  });

  it('should forget a body cleared by a demolish', () => {
    const { state, inner } = makeLoop();
    state.deathCare.reportDeath(5, 6);
    inner.refreshPendingCounts();
    expect(inner.pendingDeathCounts.get('5,6'), '前置條件:要先數到').toBe(1);

    state.deathCare.clearPendingAt(5, 6);
    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6')).toBeUndefined();
  });

  it('should follow the death queue through a service tick', () => {
    // The body queue's service tick is a separate entry point from the garbage one.
    const { state, inner } = makeLoop();
    state.deathCare.reportDeath(5, 6);
    inner.refreshPendingCounts();
    expect(inner.pendingDeathCounts.get('5,6'), '前置條件:要先數到').toBe(1);

    // No cemetery, so nothing is collected; wait for decay (bodies take 1,800 ticks, longer
    // than garbage).
    for (let i = 0; i < 1900; i++) state.deathCare.tick();
    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6'), '腐化掉的屍體還留在表上').toBeUndefined();
  });

  it('should count what a loaded save already had waiting', () => {
    // A service queue restored from a save already has entries while its version is a fresh 0.
    // If the consumer's "version at last count" also starts at 0, the first call concludes
    // nothing changed and the whole city's doorstep garbage waits for the next service tick to
    // affect happiness.
    const { state, inner } = makeLoop();
    state.garbage = GarbageService.fromJSON({
      pendingBags: [{ x: 3, y: 4, waitTicks: 0 }, { x: 3, y: 4, waitTicks: 0 }],
    } as never);

    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '讀檔之後第一次就以為自己是新的').toBe(2);
  });

  it('should count bodies a loaded save already had waiting', () => {
    // The two queues track versions separately, so both need this test: with only one side
    // wrong, the other side's version mismatch triggers a recount and masks the problem.
    const { state, inner } = makeLoop();
    state.deathCare = DeathCareService.fromJSON({
      pendingDeathQueue: [{ x: 5, y: 6, waitTicks: 0 }],
    } as never);

    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6'), '讀檔之後第一次就以為自己是新的').toBe(1);
  });

  it('should follow the queue through a service tick', () => {
    // A service tick decays anything that has waited too long, the third way a queue shrinks.
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 1);
    inner.refreshPendingCounts();
    expect(inner.pendingGarbageCounts.get('3,4'), '前置條件:要先數到').toBe(1);

    // No landfill, so nothing is collected; wait for decay.
    for (let i = 0; i < 700; i++) state.garbage.tick();
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '腐化掉的垃圾還留在表上').toBeUndefined();
  });

  it('should only recount when the queue says it changed', () => {
    // The point of the whole thing, testable only in the negative: mutating the queue behind
    // the service's public interface must **not** change the table. If it does, the count is
    // being retaken every call, and a city with 24,547 entries pays for it every tick.
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 2);
    inner.refreshPendingCounts();
    expect(inner.pendingGarbageCounts.get('3,4'), '前置條件:要先數到').toBe(2);

    const queue = state.garbage.getPendingGarbageQueue() as unknown as unknown[];
    queue.length = 0;   // cleared behind the service's back
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '每次都在重數整條佇列').toBe(2);
  });
});

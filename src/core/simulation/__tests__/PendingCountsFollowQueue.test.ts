import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { GarbageService } from '../../service/GarbageService';
import { DeathCareService } from '../../service/DeathCareService';

/**
 * 快樂度要知道「我家門口有幾包垃圾、幾具屍體」，而那張逐格的表是從兩條待處理
 * 佇列數出來的。
 *
 * 舊版每個 tick 從頭數一遍。4 萬人的存檔實測:**24 547 筆待收垃圾只落在 311 個
 * 格子上**，而佇列只在服務 tick（每 6 個）、跨日的死亡、以及玩家拆房子的時候會動
 * —— 六個 tick 裡有五個數出來的結果一模一樣。那一支佔了
 * `updateCitizenHappinessSlice` 的 63.5%、主執行緒的 4.9%。
 *
 * 現在改成「佇列說它變過才重數」。**這裡釘的就是那個『說』**:三個入口各有一條，
 * 漏掉任何一個，門口的垃圾就會晚幾個 tick 才影響快樂度 —— 而那是安靜的。
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
    // 先數過一次，快取才有東西可以沿用 —— 直接報再數的話第一次呼叫本來就會重數，
    // 「有沒有記一筆」那個判斷就照不出來。
    const { state, inner } = makeLoop();
    inner.refreshPendingCounts();

    state.garbage.reportGarbage(3, 4, 2);   // 2 包
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4')).toBe(2);
  });

  it('should not count a part-filled bag', () => {
    // 累積不到一包的量還沒進佇列 —— 那不是「門口有垃圾」。
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 0.4);
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4')).toBeUndefined();
  });

  it('should see a death as soon as it is reported', () => {
    const { state, inner } = makeLoop();
    inner.refreshPendingCounts();   // 見上面那條:要先有快取

    state.deathCare.reportDeath(5, 6);
    state.deathCare.reportDeath(5, 6);
    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6')).toBe(2);
  });

  it('should forget garbage cleared by a demolish', () => {
    // `clearPendingAt` 是玩家拆房子時走的路，**不在任何排程上** —— 拿排程當
    // 「有沒有變」的訊號就會漏掉它。
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
    // 屍體那一條的服務 tick 跟垃圾是各自獨立的入口。
    const { state, inner } = makeLoop();
    state.deathCare.reportDeath(5, 6);
    inner.refreshPendingCounts();
    expect(inner.pendingDeathCounts.get('5,6'), '前置條件:要先數到').toBe(1);

    // 沒有墓園，所以收不走;等到腐化為止（屍體是 1800 個 tick，比垃圾久）。
    for (let i = 0; i < 1900; i++) state.deathCare.tick();
    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6'), '腐化掉的屍體還留在表上').toBeUndefined();
  });

  it('should count what a loaded save already had waiting', () => {
    // 讀檔建出來的服務佇列裡本來就有東西，而版本號是全新的 0 —— 消費端那邊的
    // 「上次數的是第幾版」要是也從 0 開始，第一次就會誤判成「沒變過」，整座城市
    // 門口的垃圾要等到下一次服務 tick 才影響快樂度。
    const { state, inner } = makeLoop();
    state.garbage = GarbageService.fromJSON({
      pendingBags: [{ x: 3, y: 4, waitTicks: 0 }, { x: 3, y: 4, waitTicks: 0 }],
    } as never);

    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '讀檔之後第一次就以為自己是新的').toBe(2);
  });

  it('should count bodies a loaded save already had waiting', () => {
    // 兩條佇列各記各的版本號,所以兩邊都要有這一條 —— 只有一邊寫錯的話，另一邊
    // 的版本號不合會順便觸發重數，把問題蓋掉。
    const { state, inner } = makeLoop();
    state.deathCare = DeathCareService.fromJSON({
      pendingDeathQueue: [{ x: 5, y: 6, waitTicks: 0 }],
    } as never);

    inner.refreshPendingCounts();

    expect(inner.pendingDeathCounts.get('5,6'), '讀檔之後第一次就以為自己是新的').toBe(1);
  });

  it('should follow the queue through a service tick', () => {
    // 服務 tick 會讓等太久的東西腐化消失。那是佇列縮短的第三條路。
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 1);
    inner.refreshPendingCounts();
    expect(inner.pendingGarbageCounts.get('3,4'), '前置條件:要先數到').toBe(1);

    // 沒有垃圾場，所以收不走;等到腐化為止。
    for (let i = 0; i < 700; i++) state.garbage.tick();
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '腐化掉的垃圾還留在表上').toBeUndefined();
  });

  it('should only recount when the queue says it changed', () => {
    // 這是整件事的重點，而它只能反過來測:繞過服務的公開介面直接動佇列，那張表
    // 就**不該**跟著變。會變就代表每次都在重數，24 547 筆的城市每個 tick 都要付
    // 那筆錢。
    const { state, inner } = makeLoop();
    state.garbage.reportGarbage(3, 4, 2);
    inner.refreshPendingCounts();
    expect(inner.pendingGarbageCounts.get('3,4'), '前置條件:要先數到').toBe(2);

    const queue = state.garbage.getPendingGarbageQueue() as unknown as unknown[];
    queue.length = 0;   // 偷偷清空，不經過服務
    inner.refreshPendingCounts();

    expect(inner.pendingGarbageCounts.get('3,4'), '每次都在重數整條佇列').toBe(2);
  });
});

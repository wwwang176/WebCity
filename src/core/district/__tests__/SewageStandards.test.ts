import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 汙水處理標準:工廠與家戶少排一點，處理廠就撐得比較久。
 *
 * 量的是 `SewageService.getProduced()` —— 它是 `produceGarbageAndSewage` 那條線的
 * 出口。`getDemand()` 之類的數字是另外算的，乘在那裡不會影響任何一格。
 */

/** Small Shop（COMMERCIAL_LOW）。 */
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // A/B 的兩座城市要從同一個亂數狀態出發。不重設的話第二次接續第一次留下的
  // 序列，兩座城市會自己走岔，量到的是那個岔而不是條例。
  reseedRandom();
  // 城市開大一點:`getProduced()` 是無條件捨去的整數，量小的時候打八五折跟打七折
  // 會落在同一個數字。
  const state = createGameState(60, 60);
  for (let x = 2; x < 58; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 2; x < 58; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
  }
  return { state, loop: new SimulationLoop(state) };
}

const producedWith = (level: number) => {
  const { state, loop } = city();
  state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, level);
  // 汙水產生跑在 slowSlot 2，也就是每 6 tick 一次。
  for (let i = 0; i < 12; i++) loop.tick();
  return state.sewage.getProduced();
};

// 整個檔案都上種子:每一條測試都在比較兩座城市，而 tick 裡的建築成長、解僱、
// 車輛抖動都在擲骰子。建城時另外重設序列，讓 A/B 從同一點出發。
useSeededRandom();

describe('汙水處理標準', () => {
  it('should cut how much sewage the city puts out', () => {
    const plain = producedWith(0);
    expect(plain, '沒有汙水可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(producedWith(1), '第一級沒有減少汙水').toBeLessThan(plain);
    expect(producedWith(2), '第二級沒有比第一級更少').toBeLessThan(producedWith(1));
  });

  it('should leave less of it untreated', () => {
    // 處理廠的容量沒變，排放少了，沒處理掉的自然就少 —— 那是玩家真正在買的東西。
    const untreatedWith = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, level);
      for (let i = 0; i < 12; i++) loop.tick();
      return state.sewage.getUntreated();
    };
    const plain = untreatedWith(0);
    expect(plain, '本來就沒有未處理的汙水，量不出改善').toBeGreaterThan(0);
    expect(untreatedWith(2), '未處理的汙水沒有變少').toBeLessThan(plain);
  });

  it('should be paid for by industry', () => {
    // 製程排放的標準是壓在工廠身上的，住宅與商業不動。
    const { state } = city();
    state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, 2);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有付代價')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業也被扣了')
      .toBe(1);
  });
});

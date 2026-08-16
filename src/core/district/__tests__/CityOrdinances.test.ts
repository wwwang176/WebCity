import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_SCOPE } from '../PolicyScope';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { createGameState } from '../../simulation/GameState';
import { serializeGameState, deserializeGameState } from '../../save/Serializer';

/**
 * 有些條例的效果作用在城市級的池子上（電網總需求、教育晉級、貿易價格），沒有位置
 * 可言。判斷法:**如果「整張地圖都套用」永遠不會比「只套一部分」差，那它就該是全城
 * 的** —— 那時候「在哪裡」不是決策，逼玩家先畫分區只是多按幾下。
 */

describe('全城條例', () => {
  it('should remember the level it was set to', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(2);
  });

  it('should give every policy exactly one scope', () => {
    for (const type of Object.values(PolicyType)) {
      expect(['district', 'city'], `${type} 沒有指定範圍`).toContain(POLICY_SCOPE[type]);
    }
  });

  it('should refuse a district policy', () => {
    // 一個條例同時是分區又是全城的話，兩邊會各自生效，效果無聲地加倍。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING), '分區條例被設進了全城').toBe(0);
  });

  it('should refuse a city ordinance on a district', () => {
    // 反向也要擋。只擋一邊的話，另一邊仍然設得進去，效果加倍而費用只收一次。
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.ENERGY_REGULATION, 2);
    expect(pm.getPolicyLevel(d.id, PolicyType.ENERGY_REGULATION), '全城條例被設進了分區').toBe(0);
  });

  it('should clamp what it stores', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 99);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(3);
    o.setLevel(PolicyType.ENERGY_REGULATION, -1);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(0);
  });

  it('should cost real money at the city scale', () => {
    // 全城條例的 districtCells 恆為 0。如果每一條都用 districtCells 計費，這條路徑
    // 的費用永遠是 0，所有相關測試都會變成空測試。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(10_000), '全城條例不收錢').toBeGreaterThan(0);
    expect(o.totalCost(10_000)).toBeCloseTo(
      policyCost(PolicyType.ENERGY_REGULATION, 2, { population: 10_000, districtCells: 0 }), 6);
  });

  it('should scale with population', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(10_000)).toBeGreaterThan(o.totalCost(1_000) * 5);
  });

  it('should lower the power demand multiplier as it gets stronger', () => {
    const o = new CityOrdinances();
    expect(o.getPowerDemandMultiplier(), '什麼都沒開就已經在省電').toBe(1);
    o.setLevel(PolicyType.ENERGY_REGULATION, 1);
    const light = o.getPowerDemandMultiplier();
    o.setLevel(PolicyType.ENERGY_REGULATION, 3);
    expect(o.getPowerDemandMultiplier(), '重度沒有比輕度更省電').toBeLessThan(light);
    expect(light, '輕度完全沒有省到電').toBeLessThan(1);
  });

  it('should round-trip through a real save', () => {
    // 直接呼叫 toJSON/restore 的話，GameState 與 Serializer 漏接不會被抓到。
    const state = createGameState(20, 20);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.ordinances.getLevel(PolicyType.ENERGY_REGULATION)).toBe(3);
  });

  it('should survive a save that predates ordinances', () => {
    const o = new CityOrdinances();
    o.restore(undefined);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(0);
  });

  it('should re-check scope when restoring', () => {
    // 存檔是使用者能編輯的檔案。restore 直接塞進 Map 的話，手改的存檔就能讓一條
    // 分區條例在全城生效。
    const o = new CityOrdinances();
    o.restore({ levels: [[PolicyType.ENCOURAGE_RECYCLING, 3], [PolicyType.ENERGY_REGULATION, 99]] });
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING), '手改的存檔讓分區條例在全城生效').toBe(0);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION), '手改的等級沒有被夾住').toBe(3);
  });
});

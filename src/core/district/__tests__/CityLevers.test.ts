import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * 全城條例原本只碰得到 powerDemand 與 revenue —— crime / landValue / garbage 的
 * 消費端只問分區。這三條線補上之後，全城範圍才做得出「監視器網路」「垃圾隨袋徵收」
 * 這類條例。
 */

/** 暫時給某個全城條例塞一組效果。測的是接線，不是某一條條例現在的數字。 */
function withCityEffect(tiers: PolicyEffect[], body: (o: CityOrdinances) => void) {
  const type = PolicyType.ENERGY_REGULATION;   // 目前唯一的全城條例
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try {
    const o = new CityOrdinances();
    o.setLevel(type, 1);
    body(o);
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('全城條例的三個新槓桿', () => {
  it('should expose a city crime bonus', () => {
    withCityEffect([{ crime: 7 }], o => expect(o.getCrimeBonus()).toBe(7));
  });

  it('should expose a city land value bonus', () => {
    withCityEffect([{ landValue: -4 }], o => expect(o.getLandValueBonus()).toBe(-4));
  });

  it('should expose a city garbage multiplier', () => {
    withCityEffect([{ garbage: 0.6 }], o => expect(o.getGarbageMultiplier()).toBeCloseTo(0.6, 6));
  });

  it('should be the identity when nothing is switched on', () => {
    const o = new CityOrdinances();
    expect(o.getCrimeBonus()).toBe(0);
    expect(o.getLandValueBonus()).toBe(0);
    expect(o.getGarbageMultiplier()).toBe(1);
  });
});

/** Small Shop（COMMERCIAL_LOW）。 */
const SHOP = 7;

const WORKERS_PER_SHOP = 100;

function cityWithShops() {
  const state = createGameState(30, 30);
  const loop = new SimulationLoop(state);
  for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 14; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    // 垃圾是按實際入住人數算的（`produceGarbageAndSewage` 用 getWorkers，不是
    // 建築容量），所以沒有市民的城市產出恆為 0 —— 正向控制會先掛掉。
    //
    // 一格塞 100 個工作人口，是為了讓袋數分得開:袋子是整數，產量小的時候
    // 打八折跟打三折都會被無條件捨去成同一個數字。
    for (let i = 0; i < WORKERS_PER_SHOP; i++) {
      state.citizens.restoreCitizen({ workplaceId: toPosKey(x, 11) }, 0);
    }
  }
  return { state, loop };
}

describe('三個槓桿真的接進模擬', () => {
  // 建築直接種進格子:updateLandValue 與垃圾產生都跳過 buildingId === 0，而建築
  // 成長要求該格有電有水。

  it('should let a city ordinance move land value', () => {
    const valueWith = (tiers: PolicyEffect[] | null) => {
      const { state, loop } = cityWithShops();
      if (tiers) {
        const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
        (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = tiers;
        state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
        for (let i = 0; i < 6; i++) loop.tick();
        (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      } else {
        for (let i = 0; i < 6; i++) loop.tick();
      }
      return state.grid.getCell(10, 11)!.landValue;
    };
    const plain = valueWith(null);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(valueWith([{ landValue: -20 }]), '全城條例的地價效果沒有進到格子')
      .toBeLessThan(plain);
  });

  it('should let a city ordinance move crime', () => {
    // 犯罪只透過地價看得見（crimeRate 是 calculateLandValue 的輸入），所以量的
    // 是同一個出口 —— 但走的是不同的欄位。
    const valueWith = (crime: number) => {
      const { state, loop } = cityWithShops();
      const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = [{ crime }];
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
      for (let i = 0; i < 6; i++) loop.tick();
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      return state.grid.getCell(10, 11)!.landValue;
    };
    expect(valueWith(20), '全城條例的犯罪效果沒有進到地價').toBeLessThan(valueWith(0));
  });

  it('should not let a crime reduction create land value out of nothing', () => {
    // `calculateLandValue` 是 `value -= crimeRate * CRIME_PENALTY` —— 負的犯罪率
    // 會直接變成地價加成。壓得越低賺越多，而條例是可以疊的。
    //
    // 驗的是「壓過頭沒有額外好處」:兩個不同深度的負值必須落在同一個地價，
    // 因為兩者都該被夾成 0。沒有夾值的話，−100 會比 −50 多出 20 點地價。
    const valueWith = (crime: number) => {
      const { state, loop } = cityWithShops();
      const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = [{ crime }];
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
      for (let i = 0; i < 6; i++) loop.tick();
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      return state.grid.getCell(10, 11)!.landValue;
    };
    expect(valueWith(-100), '犯罪壓成負數之後還在繼續加地價').toBe(valueWith(-50));
  });

  it('should let a city ordinance move garbage production', () => {
    const garbageWith = (mult: number) => {
      const { state, loop } = cityWithShops();
      const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = [{ garbage: mult }];
      if (mult !== 1) state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
      // 垃圾產生跑在 slowSlot 2，也就是每 6 tick 一次 —— 12 tick 只會跑兩輪，
      // 累積量還湊不滿一個袋子。
      for (let i = 0; i < 60; i++) loop.tick();
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      // 沒有垃圾場，所以產出全部堆在 getUncollected 裡。
      return state.garbage.getUncollected();
    };
    const plain = garbageWith(1);
    expect(plain, '沒有垃圾可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(garbageWith(0.3), '全城條例沒有減少垃圾').toBeLessThan(plain);
  });
});

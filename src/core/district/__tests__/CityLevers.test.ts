import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { createGameState, type GameState } from '../../simulation/GameState';
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

/**
 * 跑一段模擬，期間讓某條全城條例帶著指定的效果。
 *
 * 還原寫在 `finally` 裡:tick 途中拋錯的話，被改過的 `POLICY_EFFECTS` 會留給同一
 * 個檔案後面的測試。
 */
function simulateWithCityEffect(
  state: GameState, loop: SimulationLoop, tiers: PolicyEffect[] | null, ticks: number,
): void {
  if (!tiers) {
    for (let i = 0; i < ticks; i++) loop.tick();
    return;
  }
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  state.ordinances.setLevel(type, 1);
  try {
    for (let i = 0; i < ticks; i++) loop.tick();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('三個槓桿真的接進模擬', () => {
  // 建築直接種進格子:updateLandValue 與垃圾產生都跳過 buildingId === 0，而建築
  // 成長要求該格有電有水。

  const landValueWith = (tiers: PolicyEffect[] | null) => {
    const { state, loop } = cityWithShops();
    simulateWithCityEffect(state, loop, tiers, 6);
    return state.grid.getCell(10, 11)!.landValue;
  };

  it('should let a city ordinance move land value', () => {
    const plain = landValueWith(null);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(landValueWith([{ landValue: -20 }]), '全城條例的地價效果沒有進到格子')
      .toBeLessThan(plain);
  });

  it('should let a city ordinance move crime', () => {
    // 犯罪走到地價的那一條線。犯罪還有另外三個出口（圖層、幸福度、棄置壓力），
    // 由 `CrimeIsReal.test.ts` 守著。
    expect(landValueWith([{ crime: 20 }]), '全城條例的犯罪效果沒有進到地價')
      .toBeLessThan(landValueWith([{ crime: 0 }]));
  });

  it('should not let a crime reduction create land value out of nothing', () => {
    // `calculateLandValue` 是 `value -= crimeRate * CRIME_PENALTY` —— 負的犯罪率
    // 會直接變成地價加成。壓得越低賺越多，而條例是可以疊的。
    //
    // 驗的是「壓過頭沒有額外好處」:兩個不同深度的負值必須落在同一個地價，
    // 因為兩者都該被夾成 0。沒有夾值的話，−100 會比 −50 多出 20 點地價。
    expect(landValueWith([{ crime: -100 }]), '犯罪壓成負數之後還在繼續加地價')
      .toBe(landValueWith([{ crime: -50 }]));
  });

  /**
   * 四種組合的垃圾量:什麼都沒開、只有分區、只有全城、兩個都開。
   *
   * 這一組是被突變測試逼出來的 —— 把 `ServiceRegistry` 那一行的分區乘數整項刪掉，
   * 只留全城的，5916 條測試全部照樣綠。只比較「有沒有變少」的話，兩個乘數少掉
   * 任何一個都還是會變少;要驗合成，就得要求兩個一起開比任何一個單獨開更少。
   */
  const garbageWith = (district: boolean, city: boolean) => {
    const { state, loop } = cityWithShops();
    if (district) {
      const d = state.districts.createDistrict('D');
      for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
      state.policies.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 3);
    }
    simulateWithCityEffect(state, loop, city ? [{ garbage: 0.5 }] : null, 60);
    return state.garbage.getUncollected();
  };

  it('should let a district policy move garbage production', () => {
    const plain = garbageWith(false, false);
    expect(plain, '沒有垃圾可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(garbageWith(true, false), '分區的回收政策沒有減少垃圾').toBeLessThan(plain);
  });

  it('should let a city ordinance move garbage production', () => {
    expect(garbageWith(false, true), '全城條例沒有減少垃圾')
      .toBeLessThan(garbageWith(false, false));
  });

  it('should multiply the two scopes together', () => {
    const both = garbageWith(true, true);
    expect(both, '兩個都開沒有比只開分區更少').toBeLessThan(garbageWith(true, false));
    expect(both, '兩個都開沒有比只開全城更少').toBeLessThan(garbageWith(false, true));
  });
});

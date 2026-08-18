import { describe, it, expect } from 'vitest';
import { billableDistricts } from '../DistrictManager';
import { computeCommuteStats } from '../../citizen/CommuteStats';
import { CitizenManager } from '../../citizen/CitizenManager';
import { policyRevenue, POLICY_REVENUE, policyCost } from '../PolicyBilling';
import { POLICY_EFFECTS } from '../PolicyManager';
import { PolicyType } from '../types';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';
import { totalPolicyRevenue } from '../../economy/ExpenseCalculator';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';

/**
 * 壅塞費是唯一一條會賺錢的條例，而它賺的錢跟「還有多少人在開車」綁在一起。
 *
 * 用格數之類的存量計價的話，在一片荒地上畫一個超大的收費區也照樣月月進帳，而且
 * 條例越成功（車越少）收入也不會掉 —— 那就不是壅塞費了。
 */

const HOME = '5,5';
const WORK = '40,5';

/** 全部收費區加起來收到幾個付費的駕駛。 */
function totalCharged(stats: { chargedDriversByDistrict: ReadonlyMap<string, number> }): number {
  let n = 0;
  for (const v of stats.chargedDriversByDistrict.values()) n += v;
  return n;
}

/** 一批通勤者，其中 `drivers` 個還在開車而且這趟碰得到收費區。 */
function statsWith(total: number, chargedDrivers: number) {
  const mgr = new CitizenManager();
  for (let i = 0; i < total; i++) {
    mgr.restoreCitizen({ age: 100, homeId: HOME, workplaceId: WORK });
  }
  let n = 0;
  return computeCommuteStats(
    mgr.getCitizens(),
    () => {
      const charged = n++ < chargedDrivers;
      return { time: 20, mode: charged ? 'DRIVE' : 'BUS', chargedDistrictId: charged ? 'd1' : null };
    },
    60, 5,
  );
}

describe('付了過路費的人數', () => {
  it('should count only the drivers whose trip touches the cordon', () => {
    expect(statsWith(10, 4).chargedDriversByDistrict.get('d1'), '付費人數不對').toBe(4);
    expect(totalCharged(statsWith(10, 0)), '沒有人付費時不該算出人數').toBe(0);
  });

  it('should not count anyone whose commute cannot be worked out', () => {
    // 路網剛改過的那幾 tick 會有一批人算不出通勤 —— 他們整個被跳過，收入也不該
    // 把他們算進去。
    const mgr = new CitizenManager();
    for (let i = 0; i < 10; i++) mgr.restoreCitizen({ age: 100, homeId: HOME, workplaceId: WORK });
    const stats = computeCommuteStats(mgr.getCitizens(), () => null, 60, 5);
    expect(totalCharged(stats), '算不出通勤的人被算進付費人數').toBe(0);
  });
});

describe('壅塞費的收入', () => {
  it('should earn from the drivers who still pay', () => {
    const busy = scaleOf({ districtCells: 40, chargedDrivers: 200 });
    const quiet = scaleOf({ districtCells: 40, chargedDrivers: 20 });
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 1, busy), '壅塞費一毛都沒收到')
      .toBeGreaterThan(0);
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 1, quiet), '車變少了收入卻沒有跟著少')
      .toBeLessThan(policyRevenue(PolicyType.CONGESTION_CHARGE, 1, busy));
  });

  it('should earn nothing from an empty cordon', () => {
    // 在荒地上畫一個超大的收費區不該是印鈔機。
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 2, scaleOf({ districtCells: 900 })),
      '沒有人開車經過卻還是收到錢').toBe(0);
  });

  it('should charge a higher toll at the higher tier', () => {
    const s = scaleOf({ districtCells: 40, chargedDrivers: 200 });
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 2, s), '第二級的過路費沒有比較貴')
      .toBeGreaterThan(policyRevenue(PolicyType.CONGESTION_CHARGE, 1, s));
  });

  it('should still cost the city its gantries', () => {
    // 一條條例可以同時兩邊都有:門架要維運，過路費要收。收入表與計費表是兩張，
    // 就是為了表達得出這件事 —— 一個帶正負號的數字表達不了。
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, scaleOf({ districtRoadCells: 40 })),
      '門架的維運費不見了').toBeGreaterThan(0);
  });

  it('should earn nothing for a policy that has no revenue side', () => {
    for (const t of [PolicyType.FREE_CLINIC, PolicyType.CURFEW, PolicyType.NO_HEAVY_INDUSTRY]) {
      expect(policyRevenue(t, 1, scaleOf({ population: 9999, chargedDrivers: 999 })),
        `${t} 憑空生出收入`).toBe(0);
    }
  });

  it('should earn nothing at level 0', () => {
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 0, scaleOf({ chargedDrivers: 500 })),
      '關掉的條例還在收錢').toBe(0);
  });

  it('should only give a revenue side to policies that have one', () => {
    // 收入表跟計費表一樣，級數必須對得上效果表 —— 走散的話第二級會靜靜地用第一級
    // 的過路費。
    const entries = Object.entries(POLICY_REVENUE);
    expect(entries.length, '收入表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type, r] of entries) {
      for (const [i, per] of r!.perUnit.entries()) {
        expect(per, `${type} 第 ${i + 1} 級的收入單價不是正數`).toBeGreaterThan(0);
      }
      for (let i = 1; i < r!.perUnit.length; i++) {
        expect(r!.perUnit[i]!, `${type} 第 ${i + 1} 級沒有比前一級收得多`)
          .toBeGreaterThan(r!.perUnit[i - 1]!);
      }
    }
  });
});


/**
 * 一座還有人開車經過收費區的城市。
 *
 * 沿用 `CongestionCharge.test.ts` 的形狀:三站一台車的長班距路線，讓公車「搭得到
 * 但輸給開車」—— 這裡要的正是「收了費之後**仍然有人**照開」，過路費才收得到。
 */
function chargedCity(charge: boolean) {
  reseedRandom();
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(6, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(16, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  state.bus.createRoute(
    [state.bus.addStop(7, 1), state.bus.addStop(15, 1), state.bus.addStop(57, 1)], 1);
  for (let k = 0; k < 20; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '16,2' });
  }
  if (charge) {
    const d = state.districts.createDistrict('Downtown');
    for (let x = 12; x <= 20; x++) {
      for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
    }
    state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
  }
  // 時鐘不要撥:通勤統計只在第 1 個 tick 與之後每 60 個 tick 跑一次，撥過去會整段
  // 視窗都錯過它，付費人數就永遠是 0。
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop };
}

useSeededRandom();

describe('過路費走到市庫', () => {
  it('should count the drivers who actually pay through the loop', () => {
    // 接線:少了這條，`chargedDrivers` 可以永遠是 0 而上面所有測試照樣全綠。
    const { loop } = chargedCity(true);
    expect(totalCharged(loop.getCommuteStats()), '沒有人被算成付了過路費')
      .toBeGreaterThan(0);
    expect(totalCharged(chargedCity(false).loop.getCommuteStats()),
      '沒開條例卻有人在付過路費').toBe(0);
  });

  it('should put the toll into the city income', () => {
    const { state, loop } = chargedCity(true);
    const expected = totalPolicyRevenue(
      loop.billableDistricts(), state.ordinances, loop.cityScales());
    expect(expected, '這座城市一毛過路費都沒收到，接線測不出來').toBeGreaterThan(0);

    // 把收入表暫時清空再結一次帳:差額就是過路費。直接比「有沒有開條例」不行 ——
    // 條例同時扣了商業收入，兩件事會混在一起。
    //
    // 每邊都要跑滿六個 tick:結帳在慢速槽上，只 tick 一次的話兩邊讀到的都是同一
    // 筆舊帳，差額會是 0 而看起來像「收入沒有進去」。
    const saved = POLICY_REVENUE[PolicyType.CONGESTION_CHARGE];
    delete (POLICY_REVENUE as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE];
    let without = 0;
    try {
      for (let i = 0; i < 6; i++) loop.tick();
      without = state.budget.income;
    } finally {
      (POLICY_REVENUE as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] = saved;
    }
    for (let i = 0; i < 6; i++) loop.tick();
    expect(state.budget.income - without, '過路費沒有進到市庫的收入')
      .toBeCloseTo(expected, 6);
  });

  it('should earn nothing once everyone has switched to the bus', () => {
    // 這條同時釘住兩件事:
    //
    // 1. 只有**還在開車**的人算付費 —— 改搭公車的人不該被收過路費。
    // 2. 這條條例做到極致會把自己的收入歸零，而門架照樣要養。那是它最有意思的
    //    地方:壅塞費做得太好會賠錢。
    const saved = POLICY_EFFECTS[PolicyType.CONGESTION_CHARGE];
    (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] =
      [{ driveDeterrence: 3, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95 } }];
    try {
      const { state, loop } = chargedCity(true);
      expect(loop.getCommuteStats().byMode['BUS'] ?? 0, '沒有人改搭公車，這條測試等於空轉')
        .toBeGreaterThan(0);
      expect(totalCharged(loop.getCommuteStats()), '改搭公車的人也被收了過路費')
        .toBe(0);
      expect(
        totalPolicyRevenue(
          loop.billableDistricts(), state.ordinances, loop.cityScales()),
        '沒有人開車了卻還在收過路費',
      ).toBe(0);
    } finally {
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] = saved;
    }
  });
});

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
 * The congestion charge is the only ordinance that earns, and what it earns is tied to how many
 * people are still driving.
 *
 * Priced against a stock such as cell count, an enormous charging zone over open country would
 * still pay every month, and revenue would not fall as the ordinance succeeded and traffic
 * dropped — at which point it is not a congestion charge.
 */

const HOME = '5,5';
const WORK = '40,5';

/** How many paying drivers all the charging zones collect between them. */
function totalCharged(stats: { chargedDriversByDistrict: ReadonlyMap<string, number> }): number {
  let n = 0;
  for (const v of stats.chargedDriversByDistrict.values()) n += v;
  return n;
}

/** A set of commuters, `chargedDrivers` of whom are still driving and cross a charging zone. */
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
    // For a few ticks after a road change a batch of citizens have no computed commute. They
    // are skipped entirely, and revenue must not count them.
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
    // An enormous charging zone over open country must not be a money printer.
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 2, scaleOf({ districtCells: 900 })),
      '沒有人開車經過卻還是收到錢').toBe(0);
  });

  it('should charge a higher toll at the higher tier', () => {
    const s = scaleOf({ districtCells: 40, chargedDrivers: 200 });
    expect(policyRevenue(PolicyType.CONGESTION_CHARGE, 2, s), '第二級的過路費沒有比較貴')
      .toBeGreaterThan(policyRevenue(PolicyType.CONGESTION_CHARGE, 1, s));
  });

  it('should still cost the city its gantries', () => {
    // One ordinance can have both: gantries need upkeep and tolls are collected. The revenue
    // and billing tables are separate precisely to express that, which a single signed number
    // cannot.
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
    // Like the billing table, the revenue table's levels must match the effect table: drifting
    // apart, level 2 silently charges level 1's toll.
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
 * A city where people still drive through the charging zone.
 *
 * The same shape as `CongestionCharge.test.ts`: a three-stop route with one vehicle and a long
 * headway, so the bus is reachable but loses to driving. What is needed here is that **some
 * people still drive** after the charge, or there are no tolls to collect.
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
  // The clock is not wound: commute statistics run on tick 1 and every 60 ticks after, so
  // winding past that window misses it entirely and the paying-driver count stays 0.
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop };
}

useSeededRandom();

describe('過路費走到市庫', () => {
  it('should count the drivers who actually pay through the loop', () => {
    // The wiring: without this, `chargedDrivers` could be permanently 0 and every test above
    // stays green.
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

    // The revenue table is temporarily emptied and the books closed again: the difference is
    // the tolls. Comparing the ordinance on and off will not do, because the ordinance also docks
    // commercial revenue and the two would be mixed together.
    //
    // Each side runs a full six ticks: closing the books is on a slow slot, and with one tick
    // both sides read the same old figures, giving a difference of 0 that looks like revenue
    // never arriving.
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
    // This pins two things:
    //
    // 1. Only people **still driving** pay: someone who switched to the bus is not tolled.
    // 2. Taken to its limit this ordinance zeroes its own revenue while the gantries still need
    //    upkeep. That is the interesting part: a congestion charge that works too well loses
    //    money.
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

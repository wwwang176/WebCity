import { describe, it, expect } from 'vitest';
import { billableDistricts } from '../DistrictManager';
import { totalPolicyRevenue } from '../../economy/ExpenseCalculator';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 一趟車只付一次過路費。
 *
 * 付費人數本來是一個全城的總數，而計費是逐分區跑的 —— 於是每一個收費區都拿整個
 * 城市的付費人數去乘。畫兩個收費區，同一筆過路費就收兩次;畫十個收十次。
 */

/** 家在西端、公司在東端，中間是一條長路。 */
function twoCordonCity(cordons: number): { state: GameState; loop: SimulationLoop } {
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

  // 第一個收費區蓋住公司那一端。
  const a = state.districts.createDistrict('Downtown');
  for (let x = 12; x <= 20; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(a.id, x, y);
  }
  state.policies.setPolicyLevel(a.id, PolicyType.CONGESTION_CHARGE, 1);

  if (cordons > 1) {
    // 第二個收費區在地圖另一頭，通勤路線根本碰不到它 —— 它一毛都不該收到。
    const b = state.districts.createDistrict('Far side');
    for (let x = 40; x <= 50; x++) {
      for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(b.id, x, y);
    }
    state.policies.setPolicyLevel(b.id, PolicyType.CONGESTION_CHARGE, 1);
  }

  // 家那一端也畫了一個分區，但**沒有開壅塞費** —— 它不該累積任何付費人頭。
  // 累積的話，玩家哪天真的開了條例，第一期就會照著一批陳年數字收錢。
  const plain = state.districts.createDistrict('No charge here');
  for (let x = 3; x <= 9; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(plain.id, x, y);
  }
  // 一批兩端都收不到費的通勤者:家在那個沒開條例的分區裡，公司在任何分區之外。
  // 沒有他們的話，「不收費就不記帳」那條分支根本走不到。
  state.grid.setCell(30, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let k = 0; k < 10; k++) {
    state.citizens.createCitizen({ age: 100, homeId: '4,2', workplaceId: '30,2' });
  }
  state.grid.setCell(4, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 12; i++) loop.tick();
  return { state, loop };
}

const tollOf = ({ state, loop }: { state: GameState; loop: SimulationLoop }) =>
  totalPolicyRevenue(
    billableDistricts(state.grid, state.districts.getAllDistricts(), loop.getCommuteStats()),
    state.ordinances, loop.cityScales());

useSeededRandom();

describe('過路費只收一次', () => {
  it('should not charge the same trip once per cordon', () => {
    const one = tollOf(twoCordonCity(1));
    expect(one, '一個收費區就收不到錢，這條測試等於空轉').toBeGreaterThan(0);
    expect(tollOf(twoCordonCity(2)), '多畫一個碰不到的收費區，過路費就翻倍了')
      .toBeCloseTo(one, 6);
  });

  it('should credit the cordon the trip actually touches', () => {
    const { state, loop } = twoCordonCity(2);
    const byDistrict = loop.getCommuteStats().chargedDriversByDistrict;
    const downtown = state.districts.getAllDistricts().find(d => d.name === 'Downtown')!;
    const farSide = state.districts.getAllDistricts().find(d => d.name === 'Far side')!;
    expect(byDistrict.get(downtown.id) ?? 0, '通勤真的碰到的那一區沒有收到人頭')
      .toBeGreaterThan(0);
    expect(byDistrict.get(farSide.id) ?? 0, '通勤碰不到的收費區也算到了人頭')
      .toBe(0);
    const noCharge = state.districts.getAllDistricts().find(d => d.name === 'No charge here')!;
    expect(byDistrict.get(noCharge.id) ?? 0, '沒開條例的分區也在累積付費人頭')
      .toBe(0);
  });
});

describe('起訖各在一個收費區', () => {
  /** 家在收費區 A、公司在收費區 B —— 同一趟車碰得到兩個收費區。 */
  function twoEndCordons(): { state: GameState; loop: SimulationLoop } {
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
    const RIDERS = 20;
    for (let k = 0; k < RIDERS; k++) {
      state.citizens.createCitizen({ age: 100, homeId: '6,2', workplaceId: '16,2' });
    }
    const home = state.districts.createDistrict('Home side');
    for (let x = 3; x <= 9; x++) {
      for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(home.id, x, y);
    }
    const work = state.districts.createDistrict('Work side');
    for (let x = 13; x <= 20; x++) {
      for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(work.id, x, y);
    }
    state.policies.setPolicyLevel(home.id, PolicyType.CONGESTION_CHARGE, 1);
    state.policies.setPolicyLevel(work.id, PolicyType.CONGESTION_CHARGE, 1);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    for (let i = 0; i < 12; i++) loop.tick();
    return { state, loop };
  }

  it('should count each trip once even when both ends are inside a cordon', () => {
    // 一趟車只過一次關卡。兩端各記一次的話，同一批人會被收兩次錢 —— 而他們正是
    // 最沒有替代方案的那一群:家跟公司都在收費區裡。
    const { loop } = twoEndCordons();
    const stats = loop.getCommuteStats();
    let charged = 0;
    for (const v of stats.chargedDriversByDistrict.values()) charged += v;
    expect(charged, '沒有人被算成付費，這條測試等於空轉').toBeGreaterThan(0);
    // 分母用統計自己的樣本數，不是當下的人口 —— 統計是在第一個 tick 算的，
    // 人口之後還會因為遷出而變動，拿現在的人口去比會比到另一件事。
    expect(charged, '起訖各在一個收費區，同一趟被收了兩次')
      .toBeLessThanOrEqual(stats.sampled);
    expect(stats.chargedDriversByDistrict.size, '同一趟被記進兩個收費區').toBe(1);
  });
});

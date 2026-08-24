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
 * One trip pays one toll.
 *
 * The paying-driver count was a city-wide total while billing runs per district, so every
 * charging zone multiplied by the whole city's paying drivers. Two zones charged the same toll
 * twice; ten charged it ten times.
 */

/** Home at the west end, work at the east end, one long road between them. */
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

  // The first charging zone covers the workplace end.
  const a = state.districts.createDistrict('Downtown');
  for (let x = 12; x <= 20; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(a.id, x, y);
  }
  state.policies.setPolicyLevel(a.id, PolicyType.CONGESTION_CHARGE, 1);

  if (cordons > 1) {
    // The second charging zone is across the map and the commute never touches it, so it should
    // collect nothing at all.
    const b = state.districts.createDistrict('Far side');
    for (let x = 40; x <= 50; x++) {
      for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(b.id, x, y);
    }
    state.policies.setPolicyLevel(b.id, PolicyType.CONGESTION_CHARGE, 1);
  }

  // The home end also has a district, but **with no congestion charge**, so it should accumulate
  // no paying drivers. Accumulating them means that the day the player enables the ordinance, its
  // first period charges against a batch of stale figures.
  const plain = state.districts.createDistrict('No charge here');
  for (let x = 3; x <= 9; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(plain.id, x, y);
  }
  // A batch of commuters charged at neither end: home in the district with no ordinance and work
  // outside every district. Without them the "no charge, no record" branch is never taken.
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
  /** Home in charging zone A and work in charging zone B, so one trip meets two zones. */
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
    // A trip crosses one cordon. Recording it at both ends charges the same people twice, and
    // they have the fewest alternatives of anyone, with home and work both inside a zone.
    const { loop } = twoEndCordons();
    const stats = loop.getCommuteStats();
    let charged = 0;
    for (const v of stats.chargedDriversByDistrict.values()) charged += v;
    expect(charged, '沒有人被算成付費，這條測試等於空轉').toBeGreaterThan(0);
    // The denominator is the statistics' own sample size rather than the current population: the
    // statistics are computed on the first tick and the population then moves with emigration, so
    // comparing against the current figure compares something else.
    expect(charged, '起訖各在一個收費區，同一趟被收了兩次')
      .toBeLessThanOrEqual(stats.sampled);
    expect(stats.chargedDriversByDistrict.size, '同一趟被記進兩個收費區').toBe(1);
  });
});

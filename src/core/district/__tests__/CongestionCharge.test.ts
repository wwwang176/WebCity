import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, tripDriveDeterrence } from '../PolicyManager';
import { policyCost } from '../PolicyBilling';
import { POLICY_SCOPE } from '../PolicyScope';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { chooseModeMultiModal, type AvailableTransport } from '../../transport/ModeChoice';
import { TransportType, TransportMode } from '../../transport/types';
import { createGameState, type GameState } from '../../simulation/GameState';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * The congestion charge: driving into the zone gets more expensive, so people with transit
 * available switch to it.
 *
 * What gets more expensive is the cost **in a citizen's reckoning**, not time on the road: a
 * charge does not slow cars down. Reported commute times are always what was actually spent, for
 * the same reason as `walkWeight`: mixing the two puts a number nobody actually spent into the
 * commute statistics and the overlay.
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 16, y: 2 };

function params(driveDeterrence: number) {
  return { congestionLevel: 0, walkSpeed: 0.35, walkWeight: 1.5, driveDeterrence };
}

/** A transit option slightly slower than driving that cannot win on its own. */
const SLOWISH_BUS: AvailableTransport[] = [
  { type: TransportType.BUS, estimatedTime: 90, walkTime: 8 },
];

describe('壅塞費怎麼改變選擇', () => {
  it('should still drive when nothing is charged', () => {
    // 50 cells with no congestion means driving costs 50. The threshold is 50 x 1.5 = 75, and
    // the bus weighs 94, above it.
    const picked = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 50, y: 0 }, SLOWISH_BUS, [], params(1));
    expect(picked.mode, '沒有收費就該開車').toBe(TransportMode.DRIVE);
  });

  it('should tip the same trip onto transit once the charge applies', () => {
    const picked = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 50, y: 0 }, SLOWISH_BUS, [], params(1.6));
    expect(picked.mode, '收了壅塞費還是開車').toBe(TransportMode.BUS);
  });

  it('should not make the drive itself take any longer', () => {
    // A charge does not slow cars down. Multiplied into the reported value, the commute
    // statistics would carry a number nobody actually spent.
    const plain = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], params(1));
    const charged = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], params(3));
    expect(plain.mode, '沒有大眾運輸可搭時就只能開車').toBe(TransportMode.DRIVE);
    expect(charged.mode, '沒有替代方案時收費也改變不了什麼').toBe(TransportMode.DRIVE);
    expect(charged.time, '收費把回報的通勤時間也一起拉長了').toBe(plain.time);
  });
});

describe('壅塞費是分區條例', () => {
  const withCharge = (level: number) => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('Downtown');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, level);
    return { pm, id: d.id };
  };

  it('should deter nobody outside a district', () => {
    expect(new PolicyManager(new DistrictManager()).getDriveDeterrence(null),
      '沒有分區卻收得到壅塞費').toBe(1);
  });

  it('should deter more at the higher tier', () => {
    expect(withCharge(1).pm.getDriveDeterrence(withCharge(1).id), '第一級沒有嚇阻力')
      .toBeGreaterThan(1);
    const light = withCharge(1);
    const heavy = withCharge(2);
    expect(heavy.pm.getDriveDeterrence(heavy.id), '第二級沒有比第一級更強')
      .toBeGreaterThan(light.pm.getDriveDeterrence(light.id));
  });

  it('should be a district policy billed by the cordon it covers', () => {
    // A congestion charge levied downtown becomes a general tax increase if levied everywhere
    // and loses its point.
    expect(POLICY_SCOPE[PolicyType.CONGESTION_CHARGE], '壅塞費不是分區條例')
      .toBe('district');
    // Gantries follow the **road** cell count: enclosing a green field should produce no
    // upkeep.
    const small = scaleOf({ population: 5000, districtCells: 200, districtRoadCells: 20 });
    const big = scaleOf({ population: 5000, districtCells: 200, districtRoadCells: 60 });
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, small), '壅塞費不收門架維運費')
      .toBeGreaterThan(0);
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, big), '路網密一倍門架卻沒有變多')
      .toBeGreaterThan(policyCost(PolicyType.CONGESTION_CHARGE, 1, small));
  });

  it('should charge a trip that touches the cordon at either end', () => {
    // The charge is collected at a cordon: driving in and driving out are one trip.
    expect(tripDriveDeterrence(1, 1.75), '從外面開進收費區沒有被收費').toBe(1.75);
    expect(tripDriveDeterrence(1.75, 1), '從收費區開出來沒有被收費').toBe(1.75);
  });

  it('should charge a trip inside the cordon once, not twice', () => {
    // Someone with both ends inside crosses one cordon. Multiplying charges them twice, and
    // they have the fewest alternatives of anyone: home and work both inside, with no guarantee
    // of a stop nearby.
    expect(tripDriveDeterrence(1.75, 1.75), '整趟都在區內的人被收了兩次過路費')
      .toBe(1.75);
  });

  it('should cost the shops inside the cordon', () => {
    const { pm, id } = withCharge(2);
    expect(pm.getRevenueMultiplier(id, ZoneType.COMMERCIAL_LOW), '商業沒有付代價')
      .toBeLessThan(1);
    expect(pm.getRevenueMultiplier(id, ZoneType.INDUSTRIAL), '工業也被扣了').toBe(1);
  });
});

/**
 * A city where the bus is reachable but loses to driving.
 *
 * That band is hard to build: with the stop out of walking range the bus is never an option at
 * all and no charge changes anything, and with it in range the bus almost always wins. So the
 * route deliberately has three stops and one vehicle: the long headway makes waiting cost the
 * bus the comparison while leaving it on the menu.
 */
function commuterCity(): { state: GameState; loop: SimulationLoop; riders: () => number } {
  reseedRandom();
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  const near = state.bus.addStop(7, 1);
  const atWork = state.bus.addStop(15, 1);
  state.bus.createRoute([near, atWork, state.bus.addStop(57, 1)], 1);
  for (let k = 0; k < 20; k++) {
    state.citizens.createCitizen({
      age: 100, homeId: HOME.x + ',' + HOME.y, workplaceId: WORK.x + ',' + WORK.y,
    });
  }
  state.clock.tick += 7;
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  return { state, loop, riders: () => near.dailyRiders + atWork.dailyRiders };
}

useSeededRandom();

describe('壅塞費走到真的通勤上', () => {
  /**
   * A multiplier clearly large enough, rather than the table's 1.75.
   *
   * The table's number sits right on this scenario's threshold, so using it to check the wiring
   * would turn red the day balance moves it to 1.6 — red for the number rather than the wiring.
   * The actual figures are guarded by the direction-per-level tests and `getDriveDeterrence`'s
   * own level tests.
   */
  const runWith = (charged: boolean) => {
    const { state, loop, riders } = commuterCity();
    const saved = POLICY_EFFECTS[PolicyType.CONGESTION_CHARGE];
    if (charged) {
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] =
        [{ driveDeterrence: 3, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95 } }];
      const d = state.districts.createDistrict('Downtown');
      // The charging zone covers the workplace end. The charge is collected at a cordon, and
      // driving in and driving out are one trip.
      for (let x = 12; x <= 20; x++) {
        for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
      }
      state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
    }
    try {
      for (let i = 0; i < 6; i++) loop.tick();
      return { riders: riders(), cars: state.traffic.getVehicleCount() };
    } finally {
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] = saved;
    }
  };

  it('should move commuters onto the bus they were ignoring', () => {
    const plain = runWith(false);
    expect(plain.riders, '沒收費時就已經有人搭公車了，量不出改變').toBe(0);
    expect(plain.cars, '本來就沒有人開車，這條測試等於空轉').toBeGreaterThan(0);

    const charged = runWith(true);
    expect(charged.riders, '收了壅塞費還是沒有人改搭公車').toBeGreaterThan(0);
    expect(charged.cars, '收了壅塞費，路上的車一樣多').toBeLessThan(plain.cars);
  });
});

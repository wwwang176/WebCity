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
 * 壅塞費:開進收費區變貴，所以有大眾運輸可搭的人改搭車。
 *
 * 貴的是**心裡的**成本，不是路上的時間 —— 收費不會讓車開得比較慢。回報的通勤時間
 * 一律是實際花掉的，跟 `walkWeight` 同一個道理:兩者混在一起的話，通勤統計與圖層
 * 上會出現一個沒有任何人真的花掉的數字。
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 16, y: 2 };

function params(driveDeterrence: number) {
  return { congestionLevel: 0, walkSpeed: 0.35, walkWeight: 1.5, driveDeterrence };
}

/** 一個比開車稍慢、單靠自己贏不了的大眾運輸選項。 */
const SLOWISH_BUS: AvailableTransport[] = [
  { type: TransportType.BUS, estimatedTime: 90, walkTime: 8 },
];

describe('壅塞費怎麼改變選擇', () => {
  it('should still drive when nothing is charged', () => {
    // 50 格、不塞車 → 開車 50。門檻是 50 × 1.5 = 75，公車加權後 94 > 75。
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
    // 收費不會讓車開得比較慢。乘進回報值的話，通勤統計上會出現一個沒有人真的
    // 花掉的數字。
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
    // 只在市中心收的壅塞費如果全城都收，就等於全面加稅，失去它原本的意義。
    expect(POLICY_SCOPE[PolicyType.CONGESTION_CHARGE], '壅塞費不是分區條例')
      .toBe('district');
    // 門架跟著**道路**格數走 —— 圈一片綠地不該產生任何維運費。
    const small = scaleOf({ population: 5000, districtCells: 200, districtRoadCells: 20 });
    const big = scaleOf({ population: 5000, districtCells: 200, districtRoadCells: 60 });
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, small), '壅塞費不收門架維運費')
      .toBeGreaterThan(0);
    expect(policyCost(PolicyType.CONGESTION_CHARGE, 1, big), '路網密一倍門架卻沒有變多')
      .toBeGreaterThan(policyCost(PolicyType.CONGESTION_CHARGE, 1, small));
  });

  it('should charge a trip that touches the cordon at either end', () => {
    // 收費是過關卡收的 —— 開進去跟開出來是同一趟。
    expect(tripDriveDeterrence(1, 1.75), '從外面開進收費區沒有被收費').toBe(1.75);
    expect(tripDriveDeterrence(1.75, 1), '從收費區開出來沒有被收費').toBe(1.75);
  });

  it('should charge a trip inside the cordon once, not twice', () => {
    // 兩端都在區內的人只過一次關卡。相乘的話等於向他收兩次 —— 而他正是最沒有
    // 替代方案的那一個:家跟公司都在區內，附近不見得有站牌。
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
 * 一座公車「搭得到、但輸給開車」的城市。
 *
 * 這個區間很難搭出來:站牌超出步行範圍的話公車根本不會被列為選項，收多少費都改變
 * 不了什麼;站牌在範圍內的話公車又幾乎穩贏。所以路線刻意排三站、只發一台車 ——
 * 班距拉長之後，等車的時間讓公車輸給開車，但它仍然留在選單上。
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
   * 用一個明確夠大的乘數，不是表上的 1.75。
   *
   * 表上的數字剛好落在這個場景的臨界點上 —— 拿它來驗接線的話，哪天平衡調到 1.6
   * 這條就會紅，而紅的原因是數字不是接線。實際的數字由「逐級的方向」與
   * `getDriveDeterrence` 的分級測試守著。
   */
  const runWith = (charged: boolean) => {
    const { state, loop, riders } = commuterCity();
    const saved = POLICY_EFFECTS[PolicyType.CONGESTION_CHARGE];
    if (charged) {
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] =
        [{ driveDeterrence: 3, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95 } }];
      const d = state.districts.createDistrict('Downtown');
      // 收費區蓋住公司那一端。收費是過關卡收的，開進去跟開出來是同一趟。
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

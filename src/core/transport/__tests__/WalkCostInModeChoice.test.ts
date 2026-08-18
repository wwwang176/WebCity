import { describe, it, expect } from 'vitest';
import { chooseModeMultiModal, type AvailableTransport } from '../ModeChoice';
import { TransportType, TransportMode } from '../types';
import type { MultiLegRoute } from '../MultiModalRouter';

/**
 * 走路要花真的走路的時間，而且走起來比坐著難熬。
 *
 * 模型裡開車是「一格一 tick」，而走路原本也是 —— 走一格到站牌跟開車走那一格成本
 * 相同。於是「走很遠去搭車」完全免費，唯一擋住它的是步行上限那個硬門檻。
 *
 * 兩件事分開處理：
 * - **速度**：走路穿越一格就是比開車久（9 km/h vs 60 km/h）。
 * - **不情願**：同樣一分鐘，走的比坐的難熬。這個只影響**比較**，回報的通勤時間
 *   仍然是實際花掉的時間 —— 混在一起的話，通勤圖層會顯示一個沒人真的花掉的數字。
 */

const WALK_SPEED = 0.15;
const NEUTRAL = { walkSpeed: WALK_SPEED, walkWeight: 1, congestionLevel: 0 , driveDeterrence: 1};

function transit(estimatedTime: number, walkTime: number): AvailableTransport {
  return { type: TransportType.BUS, estimatedTime, walkTime };
}

function multiLeg(totalTime: number, walkTime: number): MultiLegRoute {
  return {
    legs: [{ type: 'ride', fromX: 0, fromY: 0, toX: 1, toY: 0, estimatedTime: totalTime, transitType: TransportType.METRO }],
    totalTime,
    walkTime,
  };
}

describe('走路的時間', () => {
  it('should take longer to walk a cell than to drive it', () => {
    const walk = chooseModeMultiModal({ x: 0, y: 0 }, { x: 2, y: 0 }, [], [], NEUTRAL);
    expect(walk.mode).toBe(TransportMode.WALK);
    // 兩格：開車 2 tick，走路 2 / 0.15 ≈ 13.3
    expect(walk.time, '走兩格跟開兩格一樣快').toBeGreaterThan(2);
    expect(walk.time).toBeCloseTo(2 / WALK_SPEED);
  });

  it('should scale with the walk speed it is given', () => {
    const slow = chooseModeMultiModal({ x: 0, y: 0 }, { x: 3, y: 0 }, [], [],
      { ...NEUTRAL, walkSpeed: 0.1 });
    const fast = chooseModeMultiModal({ x: 0, y: 0 }, { x: 3, y: 0 }, [], [],
      { ...NEUTRAL, walkSpeed: 1 });
    expect(slow.time).toBeGreaterThan(fast.time);
  });
});

describe('步行的不情願權重', () => {
  const home = { x: 0, y: 0 };
  const work = { x: 40, y: 0 };

  it('should not change the reported time', () => {
    // 加權只用於比較。回報的必須是實際花掉的時間，否則通勤圖層上會出現一個
    // 沒有任何人真的花掉的數字。
    const patient = chooseModeMultiModal(home, work, [transit(30, 20)], [],
      { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1});
    const impatient = chooseModeMultiModal(home, work, [transit(30, 20)], [],
      { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1});

    expect(patient.mode).toBe(TransportMode.BUS);
    expect(patient.time).toBe(30);
    if (impatient.mode === TransportMode.BUS) expect(impatient.time).toBe(30);
  });

  it('should turn someone away from a trip that is mostly walking', () => {
    // 開車 40 tick。大眾運輸名目上 30 tick，但其中 25 tick 在走路 ——
    // 對走路很沒耐性的人來說，那是 25 × 2.5 + 5 = 67.5，比開車還差。
    const mostlyWalking = [transit(30, 25)];

    expect(
      chooseModeMultiModal(home, work, mostlyWalking, [], { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1}).mode,
      '不加權時本來就不搭，這條測試等於沒測',
    ).toBe(TransportMode.BUS);

    expect(
      chooseModeMultiModal(home, work, mostlyWalking, [], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '一趟通勤有八成在走路，還是照搭不誤',
    ).toBe(TransportMode.DRIVE);
  });

  it('should leave a trip that is mostly riding alone', () => {
    // 同樣 30 tick，但只有 3 tick 在走路 —— 加權幾乎不影響。
    const mostlyRiding = [transit(30, 3)];
    expect(
      chooseModeMultiModal(home, work, mostlyRiding, [], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '走幾步就到站的路線也被權重趕跑了',
    ).toBe(TransportMode.BUS);
  });

  it('should apply to transfer routes too', () => {
    const walky = multiLeg(30, 25);
    expect(
      chooseModeMultiModal(home, work, [], [walky], { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1}).mode,
    ).toBe(TransportMode.METRO);
    expect(
      chooseModeMultiModal(home, work, [], [walky], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '轉乘路線的步行段沒有被加權',
    ).toBe(TransportMode.DRIVE);
  });

  it('should compare single-transit and transfers on the same scale', () => {
    // 名目上轉乘比較快，但它幾乎全在走路 —— 加權之後應該輸給單一運具。
    const single = transit(32, 4);
    const transfer = multiLeg(30, 24);
    const choice = chooseModeMultiModal(home, work, [single], [transfer],
      { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1});

    expect(choice.multiLeg, '兩種走法沒有放在同一把尺上比').toBeNull();
    expect(choice.mode).toBe(TransportMode.BUS);
  });
});

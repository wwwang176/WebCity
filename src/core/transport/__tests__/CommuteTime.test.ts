import { describe, it, expect } from 'vitest';
import { chooseModeMultiModal, MODE_CHOICE } from '../ModeChoice';
import { TransportMode, TransportType } from '../types';
import type { MultiLegRoute, TransitLeg } from '../MultiModalRouter';

/**
 * 中性的模式選擇參數：走路一格一 tick、不加不情願權重。
 *
 * 這一檔驗的是選擇邏輯本身的算術。步行速度與權重的效果由
 * `WalkCostInModeChoice.test.ts` 單獨驗。
 */
function neutral(congestionLevel: number) {
  return { congestionLevel, walkSpeed: 1, walkWeight: 1 };
}


/**
 * 選交通方式的時候本來就得把每一種走法要花多久算出來，才知道哪一種比較快 ——
 * 但算完只留下「他要搭捷運」，時間本身被丟掉了。
 *
 * 通勤時間是市民對城市最直接的感受：它同時反映距離、壅塞與大眾運輸。換工作與
 * 搬家該用它來判斷，而不是用直線距離 —— 用距離的話，住在捷運站旁邊跟住在荒郊
 * 野外是一樣的。
 */

function rideLeg(time: number, type = TransportType.METRO): TransitLeg {
  return {
    type: 'ride', fromX: 0, fromY: 0, toX: 10, toY: 0,
    estimatedTime: time, transitType: type, routeIdx: 0, boardStopIdx: 0, alightStopIdx: 1,
  };
}

describe('通勤時間要跟著交通方式一起回傳', () => {
  it('should report how long walking takes', () => {
    const r = chooseModeMultiModal({ x: 0, y: 0 }, { x: 2, y: 1 }, [], [], neutral(0));
    expect(r.mode).toBe(TransportMode.WALK);
    expect(r.time, '走 3 格的時間').toBe(3);
  });

  it('should report drive time including congestion', () => {
    // 開車時間 = 距離 × (1 + 壅塞)。塞車讓同一段路變久，這是玩家該感受到的。
    const clear = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], neutral(0));
    const jammed = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], neutral(1));

    expect(clear.mode).toBe(TransportMode.DRIVE);
    expect(clear.time).toBe(20);
    expect(jammed.time, '壅塞沒有反映在通勤時間上').toBe(40);
  });

  it('should report the transit time when transit wins', () => {
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 40, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: 15, walkTime: 0 }],
      [], neutral(0),
    );
    expect(r.mode).toBe(TransportMode.METRO);
    expect(r.time, '搭捷運的時間沒有回傳').toBe(15);
  });

  it('should report the multi-leg total when transferring wins', () => {
    const route: MultiLegRoute = { legs: [rideLeg(8), rideLeg(9)], totalTime: 17, walkTime: 0 };
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 40, y: 0 },
      [{ type: TransportType.BUS, estimatedTime: 30, walkTime: 0 }],
      [route], neutral(0),
    );
    expect(r.multiLeg).toBe(route);
    expect(r.time).toBe(17);
  });

  it('should report the transit time even when transit is the slower choice', () => {
    // 大眾運輸只要不比開車慢過 1.5 倍就會被選 —— 市民實際花掉的是那個比較慢的
    // 時間，回報開車時間的話，換工作與搬家會以為他過得比實際好。
    const driveTime = 20;
    const transitTime = driveTime * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD - 1;
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 20, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: transitTime, walkTime: 0 }],
      [], neutral(0),
    );
    expect(r.mode).toBe(TransportMode.METRO);
    expect(r.time).toBe(transitTime);
  });

  it('should let a metro line cut the commute of a distant citizen', () => {
    // 這是整件事的重點：同一個家、同一份工作，蓋了捷運之後通勤時間下降。
    const home = { x: 0, y: 0 };
    const work = { x: 45, y: 0 };
    const before = chooseModeMultiModal(home, work, [], [], neutral(0.5));
    const after = chooseModeMultiModal(
      home, work, [{ type: TransportType.METRO, estimatedTime: 20, walkTime: 0 }], [], neutral(0.5),
    );

    expect(before.mode).toBe(TransportMode.DRIVE);
    expect(after.time, '蓋了捷運通勤時間沒有變短').toBeLessThan(before.time);
  });
});

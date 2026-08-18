import { describe, it, expect } from 'vitest';
import { TransitAccessField, estimateCommuteTime } from '../TransitAccessField';
import { TransportType, type TransportStop } from '../types';
import type { FlatRoute } from '../MultiModalRouter';
import { openFieldReach } from './openFieldReach';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from '../WalkRange';

/** 中性的模式選擇參數：走路一格一 tick、不加不情願權重。 */
function neutral(congestionLevel: number) {
  return { congestionLevel, walkSpeed: 1, walkWeight: 1 , driveDeterrence: 1};
}


/**
 * 大眾運輸可及性圖。
 *
 * 通勤時間取決於「起點 × 終點」這個**配對**，而住房分配一輪要評好幾萬組 ——
 * 用多模式路由器逐一算會直接卡死。這張圖把「這一格走得到哪些站、要走多久」
 * 先算好（路線變動時才重算），之後任兩點的通勤時間就是 O(1)。
 *
 * 精度換速度是刻意的：它只看「兩端都碰得到同一條路線」，不處理轉乘。真正要
 * 派車時仍然走完整的多模式路由器，這張圖只用來評分與觸發判斷。
 */

function stop(id: number, x: number, y: number, type = TransportType.METRO): TransportStop {
  return { id, x, y, type, passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0 };
}

/** 一條沿 y 軸、每 gap 格一站的路線。 */
function verticalLine(
  routeId: number, x: number, y0: number, y1: number, gap: number,
  speed = 3, frequency = 10, type = TransportType.METRO,
): FlatRoute {
  const stops: TransportStop[] = [];
  for (let y = y0, i = 0; y <= y1; y += gap, i++) stops.push(stop(routeId * 100 + i, x, y, type));
  return { routeId, type, speed, stops, segDists: null, headway: frequency, loadFactor: 0 };
}

const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;

function fieldFor(routes: FlatRoute[]) {
  return TransitAccessField.build(routes, WALK_SPEED, openFieldReach);
}

describe('可及性圖', () => {
  const line = verticalLine(1, 30, 0, 60, 6);

  it('should report zero walk time on top of a stop', () => {
    const f = fieldFor([line]);
    const access = f.at(30, 12);
    expect(access.length, '站牌那一格查不到任何路線').toBeGreaterThan(0);
    expect(access[0]!.walkTime).toBe(0);
  });

  it('should scale walk time with distance', () => {
    const f = fieldFor([line]);
    const near = f.at(32, 12)[0]!;
    const far = f.at(34, 12)[0]!;
    expect(near.walkTime).toBeLessThan(far.walkTime);
  });

  it('should report nothing beyond walking range', () => {
    // 距離從上限推出來，不寫死 —— 寫死的話上限一調就變成「這個數字剛好還在範圍
    // 內」，測試看起來仍然在驗邊界，實際上驗的是另一件事。
    const beyond = walkRangeFor(TransportType.METRO) + 1;
    const f = fieldFor([line]);
    expect(f.at(30 + beyond, 12), `離站 ${beyond} 格還走得到`).toHaveLength(0);
  });

  it('should cut coverage at the per-mode limit, not the scan radius', () => {
    // 掃描一律用最寬的半徑，再由運具自己的上限截斷。只有上限小於掃描半徑的運具
    // 驗得到那道截斷 —— 拿捷運驗的話，擋掉遠處那一格的其實是掃描範圍本身，把
    // 截斷整個拿掉測試也不會紅。
    const busLimit = walkRangeFor(TransportType.BUS);
    expect(busLimit, '公車上限沒有小於掃描半徑，這個測試驗不到截斷')
      .toBeLessThan(WALK_RANGE_BY_TYPE.WIDEST);

    const f = fieldFor([verticalLine(2, 30, 0, 60, 6, 1, 10, TransportType.BUS)]);
    expect(f.at(30 + busLimit, 12), '公車上限內反而查不到').toHaveLength(1);
    expect(f.at(30 + busLimit + 1, 12), '超過公車上限還走得到').toHaveLength(0);
  });

  it('should not blow up on a city with no transit', () => {
    const f = fieldFor([]);
    expect(f.at(5, 5)).toHaveLength(0);
  });

  it('should keep one entry per route, the nearest stop', () => {
    // 同一條路線有很多站，只留最近的那一個 —— 留全部的話這張圖會膨脹成
    // 站數 × 覆蓋面積，而遠一點的那些站永遠不會被選。
    const f = fieldFor([line]);
    const access = f.at(30, 15);
    expect(access).toHaveLength(1);
    expect(access[0]!.walkTime, '沒有挑最近的那一站').toBe(3);
  });
});

describe('通勤時間估計', () => {
  const line = verticalLine(1, 30, 0, 60, 6);

  it('should fall back to driving with no transit at all', () => {
    const f = fieldFor([]);
    const t = estimateCommuteTime({ x: 0, y: 0 }, { x: 20, y: 0 }, neutral(0.5), f, [], WAIT_FACTOR);
    expect(t, '開車時間 = 直線距離 × (1 + 壅塞)').toBe(30);
  });

  it('should charge more for the same trip when the roads are jammed', () => {
    const f = fieldFor([]);
    const clear = estimateCommuteTime({ x: 0, y: 0 }, { x: 20, y: 0 }, neutral(0), f, [], WAIT_FACTOR);
    const jammed = estimateCommuteTime({ x: 0, y: 0 }, { x: 20, y: 0 }, neutral(1), f, [], WAIT_FACTOR);
    expect(jammed).toBeGreaterThan(clear);
  });

  it('should cut the commute of someone living and working near the line', () => {
    // 這是整件事的重點：住得遠，但兩端都在站旁邊。
    const f = fieldFor([line]);
    const home = { x: 31, y: 6 };
    const work = { x: 29, y: 54 };
    const withTransit = estimateCommuteTime(home, work, neutral(0.3), f, [line], WAIT_FACTOR);
    const noTransit = estimateCommuteTime(home, work, neutral(0.3), fieldFor([]), [], WAIT_FACTOR);

    expect(withTransit, '兩端都在站旁邊，通勤時間卻沒有變短').toBeLessThan(noTransit);
    expect(withTransit).toBeLessThan(40);
  });

  it('should not help someone who can only reach a stop at one end', () => {
    const f = fieldFor([line]);
    const home = { x: 31, y: 6 };   // 站旁
    const work = { x: 55, y: 54 };  // 荒郊
    const t = estimateCommuteTime(home, work, neutral(0.3), f, [line], WAIT_FACTOR);
    const drive = (Math.abs(55 - 31) + Math.abs(54 - 6)) * 1.3;
    expect(t, '只有一端有站也算得到好處').toBeCloseTo(drive, 5);
  });

  it('should not connect two stops that belong to different routes', () => {
    // 這張圖不處理轉乘。兩端各碰到一條不同的路線，等於沒有直達的選擇。
    const a = verticalLine(1, 30, 0, 20, 6);
    const b = verticalLine(2, 30, 40, 60, 6);
    const f = fieldFor([a, b]);
    const t = estimateCommuteTime({ x: 30, y: 6 }, { x: 30, y: 54 }, neutral(0.3), f, [a, b], WAIT_FACTOR);
    expect(t).toBeCloseTo(48 * 1.3, 5);
  });

  it('should include waiting and walking, not just the ride', () => {
    // 只算乘車時間的話，一條班距很長的路線看起來會跟捷運一樣好。
    const frequent = verticalLine(1, 30, 0, 60, 6, 3, 2);
    const rare = verticalLine(1, 30, 0, 60, 6, 3, 40);
    const home = { x: 30, y: 6 }, work = { x: 30, y: 54 };
    const tFrequent = estimateCommuteTime(home, work, neutral(0.3), fieldFor([frequent]), [frequent], WAIT_FACTOR);
    const tRare = estimateCommuteTime(home, work, neutral(0.3), fieldFor([rare]), [rare], WAIT_FACTOR);
    expect(tRare, '班距沒有反映在通勤時間上').toBeGreaterThan(tFrequent);
  });

  it('should walk for a trip that is short enough', () => {
    const f = fieldFor([]);
    expect(estimateCommuteTime({ x: 0, y: 0 }, { x: 1, y: 1 }, neutral(0.5), f, [], WAIT_FACTOR)).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  cellCongestion, routeCongestion, cityCongestion, FLOW_PER_LANE_SATURATED,
} from '../RouteCongestion';

/**
 * 舊的做法是數畫面上有幾台車:`車輛實體數 ÷ (有車的格數 × 3)`。12 254 人的存檔實測
 * 連續取樣六次全部是 1.000 —— 分母只算有車的格子,空路不算,所以城市一有規模就永遠
 * 貼在上限,蓋路不會降、塞車不會升（BUG-326）。
 *
 * 這裡改成從需求算:每一格上有多少人的通勤路線經過。
 */

const flowOf = (m: Record<string, number>) => (k: string) => m[k] ?? 0;

describe('一格有多擠', () => {
  it('should be zero for an empty cell', () => {
    expect(cellCongestion(0)).toBe(0);
  });

  it('should rise with flow and stop at one', () => {
    expect(cellCongestion(FLOW_PER_LANE_SATURATED / 2)).toBeCloseTo(0.5, 10);
    expect(cellCongestion(FLOW_PER_LANE_SATURATED)).toBe(1);
    expect(cellCongestion(FLOW_PER_LANE_SATURATED * 10), '塞爆之後還繼續往上長').toBe(1);
  });

  it('should treat a negative or broken flow as empty', () => {
    // 流量圖是別人算的,壞掉的值不該變成 NaN 一路傳進通勤時間裡。
    expect(cellCongestion(-5)).toBe(0);
    expect(cellCongestion(NaN)).toBe(0);
  });
});

describe('這一趟有多擠', () => {
  it('should average the cells along the way', () => {
    const S = FLOW_PER_LANE_SATURATED;
    const cong = routeCongestion(['a', 'b', 'c', 'd'], flowOf({ a: S, b: S, c: 0, d: 0 }));
    expect(cong, '沿途平均算錯').toBeCloseTo(0.5, 10);
  });

  it('should not let one bad junction condemn the whole trip', () => {
    // 取最大值的話,所有經過市中心的人都會變成一樣糟 —— 而開車時間是沿路累積的,
    // 卡一個路口跟整條路都在爬不是同一件事。
    const S = FLOW_PER_LANE_SATURATED;
    const oneJam = routeCongestion(
      ['a', 'b', 'c', 'd', 'e'], flowOf({ a: S }),
    );
    const allJam = routeCongestion(
      ['a', 'b', 'c', 'd', 'e'], flowOf({ a: S, b: S, c: S, d: S, e: S }),
    );
    expect(oneJam!, '一個路口就把整趟判成塞爆').toBeLessThan(allJam!);
    expect(oneJam!).toBeCloseTo(0.2, 10);
  });

  it('should say nothing about a route with no cells', () => {
    // 回 0 的話等於謊稱「暢通」,呼叫端就不會去找退路了。
    expect(routeCongestion([], flowOf({})), '沒有路線卻回報暢通').toBeNull();
  });

  it('should count a cell once per time the route passes it', () => {
    // 路線是格子的序列。同一格經過兩次就是塞兩次 —— 呼叫端若要去重,自己傳 Set。
    const S = FLOW_PER_LANE_SATURATED;
    expect(routeCongestion(['a', 'a', 'b'], flowOf({ a: S }))).toBeCloseTo(2 / 3, 10);
  });
});

describe('整個路網有多擠', () => {
  it('should count empty roads in the denominator', () => {
    // 這是舊算法壞掉的地方:只看有車的格子,城市愈大分母愈跟著漲,數字永遠貼上限。
    const S = FLOW_PER_LANE_SATURATED;
    const flow = new Map([['a', S], ['b', S]]);
    expect(cityCongestion(flow, 2), '兩格路全滿卻不是塞死').toBe(1);
    expect(cityCongestion(flow, 20), '另外十八格空路完全沒被算進去').toBeCloseTo(0.1, 10);
  });

  it('should fall as roads are added', () => {
    // 蓋路要有用 —— 這是整件事的重點。
    const S = FLOW_PER_LANE_SATURATED;
    const flow = new Map([['a', S], ['b', S / 2]]);
    const before = cityCongestion(flow, 4);
    const after = cityCongestion(flow, 8);
    expect(after, '蓋了路，路網負載卻沒有下降').toBeLessThan(before);
  });

  it('should be zero for a city with no roads', () => {
    expect(cityCongestion(new Map(), 0)).toBe(0);
  });
});

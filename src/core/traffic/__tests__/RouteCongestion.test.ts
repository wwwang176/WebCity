import { describe, it, expect } from 'vitest';
import {
  cellCongestion, routeCongestion, cityCongestion,
  FLOW_PER_LANE_SATURATED, CONGESTION_EXPONENT,
} from '../RouteCongestion';

/**
 * Congestion is derived from demand — how many citizens' commute routes cross each cell.
 *
 * Counting the vehicles on screen instead (`vehicle entities / (occupied cells x 3)`) sampled
 * 1.000 six times in a row on a 12,254-population save: the denominator counts only occupied
 * cells, so any city of size pins to the ceiling permanently, and building roads never lowers
 * it nor traffic raise it (BUG-326).
 */

const flowOf = (m: Record<string, number>) => (k: string) => m[k] ?? 0;

describe('一格有多擠', () => {
  it('should be zero for an empty cell', () => {
    expect(cellCongestion(0)).toBe(0);
  });

  it('should rise with flow and stop at one', () => {
    const S = FLOW_PER_LANE_SATURATED;
    expect(cellCongestion(S / 2), '半滿的路').toBeCloseTo(0.5 ** CONGESTION_EXPONENT, 10);
    expect(cellCongestion(S)).toBe(1);
    expect(cellCongestion(S * 10), '塞爆之後還繼續往上長').toBe(1);
  });

  it('should hurt far more near capacity than when half empty', () => {
    // One more vehicle on an empty road is unnoticeable; one more on a nearly full road jams
    // the whole queue. Linear weighting makes both equal, so relieving a bottleneck junction
    // pays the same as widening a road that already flows, and the player gets no feedback for
    // spending on the bottleneck.
    const S = FLOW_PER_LANE_SATURATED;
    const lowStep = cellCongestion(S * 0.5) - cellCongestion(S * 0.25);
    const highStep = cellCongestion(S * 1.0) - cellCongestion(S * 0.75);
    expect(highStep, '最後一段跟中間一段一樣痛 —— 那是線性').toBeGreaterThan(lowStep * 4);
  });

  it('should stay in step with the exponent it advertises', () => {
    // With the constant and the formula written independently, the calibrated number and the
    // actual behaviour drift apart.
    const S = FLOW_PER_LANE_SATURATED;
    for (const load of [0.1, 0.35, 0.6, 0.99]) {
      expect(cellCongestion(S * load), `負載 ${load} 跟指數對不起來`)
        .toBeCloseTo(load ** CONGESTION_EXPONENT, 10);
    }
  });

  it('should treat a negative or broken flow as empty', () => {
    // The flow map is computed elsewhere, and a broken value must not become a NaN that
    // propagates into commute times.
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
    // Taking the maximum makes everyone crossing downtown equally badly off, but driving time
    // accumulates along the way: one blocked junction is not the same as crawling the whole
    // route.
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
    // Returning 0 would claim clear roads and stop the caller looking for a fallback.
    expect(routeCongestion([], flowOf({})), '沒有路線卻回報暢通').toBeNull();
  });

  it('should count a cell once per time the route passes it', () => {
    // A route is a sequence of cells: crossing one twice means being stuck there twice. A
    // caller that wants deduplication passes a Set.
    const S = FLOW_PER_LANE_SATURATED;
    expect(routeCongestion(['a', 'a', 'b'], flowOf({ a: S }))).toBeCloseTo(2 / 3, 10);
  });
});

describe('整個路網有多擠', () => {
  it('should count empty roads in the denominator', () => {
    // Where the vehicle-counting measure broke: counting only occupied cells grows the
    // denominator with the city and pins the number to the ceiling.
    const S = FLOW_PER_LANE_SATURATED;
    const flow = new Map([['a', S], ['b', S]]);
    expect(cityCongestion(flow, 2), '兩格路全滿卻不是塞死').toBe(1);
    expect(cityCongestion(flow, 20), '另外十八格空路完全沒被算進去').toBeCloseTo(0.1, 10);
  });

  it('should fall as roads are added', () => {
    // Building roads has to help; that is the point of the whole measure.
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

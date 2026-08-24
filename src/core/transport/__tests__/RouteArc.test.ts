import { describe, it, expect } from 'vitest';
import { sampleRouteArc, buildRoutePolyline, ARC } from '../RouteArc';

/**
 * Stop-to-stop connectors are drawn as parabolas.
 *
 * Straight connectors smear together on a dense network: two routes sharing a stretch
 * overlap exactly, so it is impossible to tell which one serves which stop. Arcing gives
 * every hop its own curve and makes hop length readable.
 *
 * Three properties are pinned here: **endpoints must sit on the stops** (a floating line
 * does not connect to the stop), **the horizontal projection must stay straight** (a skewed
 * arc bends around unrelated blocks), and **the rise must be capped** (a proportional rise
 * takes a cross-city route out of frame).
 */

const A = { x: 0, y: 0 };
const B = { x: 10, y: 0 };
const BASE_Y = 0.15;

describe('拋物線連線', () => {
  it('should start and end exactly on the stops', () => {
    const pts = sampleRouteArc(A, B, BASE_Y);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    expect([first.x, first.y, first.z]).toEqual([A.x, BASE_Y, A.y]);
    expect([last.x, last.y, last.z]).toEqual([B.x, BASE_Y, B.y]);
  });

  it('should rise in the middle', () => {
    const pts = sampleRouteArc(A, B, BASE_Y);
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(mid.y, '線是平的，根本沒有拱起來').toBeGreaterThan(BASE_Y);
  });

  it('should peak at the middle and nowhere else', () => {
    const pts = sampleRouteArc(A, B, BASE_Y);
    let peakIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]!.y > pts[peakIdx]!.y) peakIdx = i;
    }
    const middle = (pts.length - 1) / 2;
    expect(Math.abs(peakIdx - middle), '最高點不在正中間').toBeLessThanOrEqual(0.5);
  });

  it('should never dip below the base height', () => {
    for (const p of sampleRouteArc(A, B, BASE_Y)) {
      expect(p.y).toBeGreaterThanOrEqual(BASE_Y);
    }
  });

  it('should keep the horizontal projection on the straight line', () => {
    // The arc rises vertically only; a horizontal deviation would bend the line around
    // unrelated blocks.
    const from = { x: 2, y: 3 };
    const to = { x: 8, y: 11 };
    const dx = to.x - from.x;
    const dz = to.y - from.y;
    for (const p of sampleRouteArc(from, to, BASE_Y)) {
      // A zero cross product means the point lies on the from->to line.
      const cross = (p.x - from.x) * dz - (p.z - from.y) * dx;
      expect(Math.abs(cross), '弧在水平方向也偏掉了').toBeLessThan(1e-9);
    }
  });

  it('should arc higher for longer hops', () => {
    const shortRise = peakRise(sampleRouteArc(A, { x: 4, y: 0 }, BASE_Y));
    const longRise = peakRise(sampleRouteArc(A, { x: 12, y: 0 }, BASE_Y));
    expect(longRise, '長短跳拱得一樣高，看不出距離').toBeGreaterThan(shortRise);
  });

  it('should cap the rise so a cross-city route stays in frame', () => {
    const rise = peakRise(sampleRouteArc(A, { x: 400, y: 0 }, BASE_Y));
    expect(rise).toBeLessThanOrEqual(ARC.RISE_MAX + 1e-9);
  });

  it('should survive two stops on the same cell', () => {
    // Two stops on the same cell (just placed, not yet moved apart) are 0 apart, and
    // normalising divides by zero.
    const pts = sampleRouteArc(A, { ...A }, BASE_Y);
    for (const p of pts) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });
});

describe('整條路線的折線', () => {
  const STOPS = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

  it('should close the ring back to the first stop', () => {
    const pts = buildRoutePolyline(STOPS, BASE_Y);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    expect([last.x, last.z], '環形路線沒有繞回第一站').toEqual([first.x, first.z]);
  });

  it('should not repeat the joint between two hops', () => {
    // Every hop samples its own start, so concatenating directly repeats the intermediate
    // stop and breaks the dash cadence at every stop.
    const pts = buildRoutePolyline(STOPS, BASE_Y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      expect(a.x === b.x && a.y === b.y && a.z === b.z, `第 ${i} 點與前一點重複`).toBe(false);
    }
  });

  it('should touch every stop at the base height', () => {
    const pts = buildRoutePolyline(STOPS, BASE_Y);
    for (const s of STOPS) {
      const hit = pts.find(p => p.x === s.x && p.z === s.y);
      expect(hit, `路線沒有經過 (${s.x},${s.y})`).toBeDefined();
      expect(hit!.y, '線在站牌上方浮著，接不到站').toBe(BASE_Y);
    }
  });

  it('should give back nothing for a route that cannot be drawn', () => {
    expect(buildRoutePolyline([], BASE_Y)).toEqual([]);
    expect(buildRoutePolyline([{ x: 1, y: 1 }], BASE_Y)).toEqual([]);
  });
});

function peakRise(pts: { y: number }[]): number {
  return Math.max(...pts.map(p => p.y)) - BASE_Y;
}

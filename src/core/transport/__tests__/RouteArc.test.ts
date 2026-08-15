import { describe, it, expect } from 'vitest';
import { sampleRouteArc, buildRoutePolyline, ARC } from '../RouteArc';

/**
 * 站與站之間的連線畫成拋物線。
 *
 * 直線連線在密集的路網上會糊成一團 —— 兩條共用同一段的路線完全重疊，看不出
 * 哪一條經過哪一站。拱起來之後每一跳各自成弧，長短一眼看得出來。
 *
 * 三件事在這裡把關：**端點必須落在站上**（浮起來的話線就接不到站牌）、
 * **水平投影必須是直線**（歪掉的話弧會繞過不相干的街區）、
 * **拱高有上限**（照比例長下去的話，跨城的路線會拱到鏡頭外）。
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
    // 弧只在垂直方向拱。水平也偏出去的話，線會繞過不相干的街區。
    const from = { x: 2, y: 3 };
    const to = { x: 8, y: 11 };
    const dx = to.x - from.x;
    const dz = to.y - from.y;
    for (const p of sampleRouteArc(from, to, BASE_Y)) {
      // 叉積 = 0 表示點落在 from→to 這條線上
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
    // 同一格上的兩站（剛蓋好還沒挪開）距離是 0 —— 正規化會除以零。
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
    // 每一跳都自己從頭取樣，接起來的話中間那一站會出現兩次 —— 虛線的節拍會在
    // 每個站牌打結。
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

import { describe, it, expect } from 'vitest';
import { buildFerryPathInfo, interpolateFerryPath } from '../FerryLinePath';

describe('FerryLinePath', () => {
  describe('buildFerryPathInfo', () => {
    it('直線路徑應計算正確的總長度', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      ]);
      expect(info.totalLength).toBe(3);
      expect(info.segmentLengths).toEqual([1, 1, 1]);
      expect(info.cumulativeLengths).toEqual([0, 1, 2, 3]);
    });

    it('對角線路徑應計算 sqrt(2) 長度', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 1, y: 1 },
      ]);
      expect(info.totalLength).toBeCloseTo(Math.SQRT2, 5);
    });

    it('單點路徑總長度為 0', () => {
      const info = buildFerryPathInfo([{ x: 5, y: 5 }]);
      expect(info.totalLength).toBe(0);
      expect(info.segmentLengths).toEqual([]);
    });

    it('空路徑總長度為 0', () => {
      const info = buildFerryPathInfo([]);
      expect(info.totalLength).toBe(0);
    });
  });

  describe('interpolateFerryPath', () => {
    it('distance=0 應返回路徑起點', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 3, y: 0 },
      ]);
      const p = interpolateFerryPath(info, 0);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(0);
      expect(p!.y).toBeCloseTo(0);
    });

    it('distance=totalLength 應返回路徑終點', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 3, y: 0 },
      ]);
      const p = interpolateFerryPath(info, 3);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(3);
      expect(p!.y).toBeCloseTo(0);
    });

    it('中間距離應正確插值', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 },
      ]);
      const p = interpolateFerryPath(info, 1);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(1);
      expect(p!.y).toBeCloseTo(0);
    });

    it('heading 應指向行進方向（東向）', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 3, y: 0 },
      ]);
      const p = interpolateFerryPath(info, 1);
      expect(p).not.toBeNull();
      // heading = atan2(-(0-0), 3-0) = atan2(0, 3) = 0 (east)
      expect(p!.heading).toBeCloseTo(0);
    });

    it('heading 應指向行進方向（南向）', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 0, y: 3 },
      ]);
      const p = interpolateFerryPath(info, 1);
      expect(p).not.toBeNull();
      // heading = atan2(-(3-0), 0-0) = atan2(-3, 0) = -PI/2
      expect(p!.heading).toBeCloseTo(-Math.PI / 2);
    });

    it('超過總長度應 clamp 到終點', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 2, y: 0 },
      ]);
      const p = interpolateFerryPath(info, 100);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(2);
      expect(p!.y).toBeCloseTo(0);
    });

    it('負距離應 clamp 到起點', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 2, y: 0 },
      ]);
      const p = interpolateFerryPath(info, -5);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(0);
      expect(p!.y).toBeCloseTo(0);
    });

    it('轉彎路徑應在正確段上插值', () => {
      const info = buildFerryPathInfo([
        { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 },
      ]);
      // First leg length=2, second leg length=2, total=4.
      // distance=3 lands on the second leg at localT = (3-2)/2 = 0.5.
      const p = interpolateFerryPath(info, 3);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(2);
      expect(p!.y).toBeCloseTo(1);
      // heading = atan2(-(2-0), 0) = atan2(-2, 0) = -PI/2 (south)
      expect(p!.heading).toBeCloseTo(-Math.PI / 2);
    });

    it('路徑太短應返回 null', () => {
      const info = buildFerryPathInfo([{ x: 0, y: 0 }]);
      expect(interpolateFerryPath(info, 0)).toBeNull();
    });
  });
});

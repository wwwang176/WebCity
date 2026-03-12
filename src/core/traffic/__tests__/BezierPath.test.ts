import { describe, it, expect } from 'vitest';
import {
  quadraticBezierPoint,
  quadraticBezierTangent,
  cubicBezierPoint,
  cubicBezierTangent,
  buildArcLengthLUT,
  sampleAtDistance,
  computeTurnControlPoint,
} from '../BezierPath';

describe('BezierPath', () => {
  describe('quadraticBezierPoint', () => {
    it('should return start point at t=0', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 1, y: 1 };
      const p2 = { x: 2, y: 0 };
      const pt = quadraticBezierPoint(p0, cp, p2, 0);
      expect(pt.x).toBeCloseTo(0);
      expect(pt.y).toBeCloseTo(0);
    });

    it('should return end point at t=1', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 1, y: 1 };
      const p2 = { x: 2, y: 0 };
      const pt = quadraticBezierPoint(p0, cp, p2, 1);
      expect(pt.x).toBeCloseTo(2);
      expect(pt.y).toBeCloseTo(0);
    });

    it('should return midpoint for straight line', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const pt = quadraticBezierPoint(p0, cp, p2, 0.5);
      expect(pt.x).toBeCloseTo(1);
      expect(pt.y).toBeCloseTo(0);
    });

    it('should curve toward control point at t=0.5', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 0, y: 1 };
      const p2 = { x: 1, y: 1 };
      const pt = quadraticBezierPoint(p0, cp, p2, 0.5);
      // Quadratic midpoint: (1-0.5)²·0 + 2·0.5·0.5·0 + 0.5²·1 = 0.25
      expect(pt.x).toBeCloseTo(0.25);
      // y: (1-0.5)²·0 + 2·0.5·0.5·1 + 0.5²·1 = 0.5 + 0.25 = 0.75
      expect(pt.y).toBeCloseTo(0.75);
    });
  });

  describe('quadraticBezierTangent', () => {
    it('should return correct tangent at t=0 (aligned with p0→cp)', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 0, y: 1 };
      const p2 = { x: 1, y: 1 };
      const t = quadraticBezierTangent(p0, cp, p2, 0);
      // At t=0, tangent = 2*(cp - p0) = (0, 2)
      expect(t.x).toBeCloseTo(0);
      expect(t.y).toBeCloseTo(2);
    });

    it('should return correct tangent at t=1 (aligned with cp→p2)', () => {
      const p0 = { x: 0, y: 0 };
      const cp = { x: 0, y: 1 };
      const p2 = { x: 1, y: 1 };
      const t = quadraticBezierTangent(p0, cp, p2, 1);
      // At t=1, tangent = 2*(p2 - cp) = (2, 0)
      expect(t.x).toBeCloseTo(2);
      expect(t.y).toBeCloseTo(0);
    });
  });

  describe('cubicBezierPoint', () => {
    it('should return start point at t=0', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 1, y: 1 };
      const p3 = { x: 0, y: 1 };
      const pt = cubicBezierPoint(p0, p1, p2, p3, 0);
      expect(pt.x).toBeCloseTo(0);
      expect(pt.y).toBeCloseTo(0);
    });

    it('should return end point at t=1', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 1, y: 1 };
      const p3 = { x: 0, y: 1 };
      const pt = cubicBezierPoint(p0, p1, p2, p3, 1);
      expect(pt.x).toBeCloseTo(0);
      expect(pt.y).toBeCloseTo(1);
    });

    it('should return midpoint close to center for symmetric curve', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const pt = cubicBezierPoint(p0, p1, p2, p3, 0.5);
      expect(pt.x).toBeCloseTo(1.5);
      expect(pt.y).toBeCloseTo(0);
    });
  });

  describe('cubicBezierTangent', () => {
    it('should return correct tangent at t=0 (aligned with p0→p1)', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 1, y: 1 };
      const p3 = { x: 0, y: 1 };
      const t = cubicBezierTangent(p0, p1, p2, p3, 0);
      expect(t.x).toBeCloseTo(3);
      expect(t.y).toBeCloseTo(0);
    });

    it('should return correct tangent at t=1 (aligned with p2→p3)', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 1, y: 1 };
      const p3 = { x: 0, y: 1 };
      const t = cubicBezierTangent(p0, p1, p2, p3, 1);
      expect(t.x).toBeCloseTo(-3);
      expect(t.y).toBeCloseTo(0);
    });
  });

  describe('buildArcLengthLUT', () => {
    it('should return a LUT with N+1 entries', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 20);
      expect(lut.length).toBe(21);
    });

    it('should start at 0 and end at total arc length', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 20);
      expect(lut[0]).toBeCloseTo(0);
      expect(lut[lut.length - 1]).toBeCloseTo(3, 1);
    });

    it('should be monotonically increasing', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 0.5, y: 0.3 };
      const p2 = { x: 0.7, y: 0.8 };
      const p3 = { x: 1, y: 1 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 50);
      for (let i = 1; i < lut.length; i++) {
        expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
      }
    });
  });

  describe('sampleAtDistance', () => {
    it('should return start point at distance=0', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 50);
      const pt = sampleAtDistance(p0, p1, p2, p3, lut, 0);
      expect(pt.position.x).toBeCloseTo(0, 1);
      expect(pt.position.y).toBeCloseTo(0, 1);
    });

    it('should return end point at distance=totalLength', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 50);
      const totalLength = lut[lut.length - 1]!;
      const pt = sampleAtDistance(p0, p1, p2, p3, lut, totalLength);
      expect(pt.position.x).toBeCloseTo(3, 1);
      expect(pt.position.y).toBeCloseTo(0, 1);
    });

    it('should return midpoint at distance=totalLength/2 for a straight line', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 2, y: 0 };
      const p3 = { x: 3, y: 0 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 50);
      const totalLength = lut[lut.length - 1]!;
      const pt = sampleAtDistance(p0, p1, p2, p3, lut, totalLength / 2);
      expect(pt.position.x).toBeCloseTo(1.5, 1);
      expect(pt.position.y).toBeCloseTo(0, 1);
    });

    it('arc-length parameterized samples should be roughly equal-spaced', () => {
      const p0 = { x: 1, y: 0 };
      const p1 = { x: 1, y: 0.55 };
      const p2 = { x: 0.55, y: 1 };
      const p3 = { x: 0, y: 1 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 100);
      const totalLength = lut[lut.length - 1]!;

      const points = [];
      for (let i = 0; i <= 4; i++) {
        const d = (i / 4) * totalLength;
        points.push(sampleAtDistance(p0, p1, p2, p3, lut, d));
      }

      const dists = [];
      for (let i = 1; i < points.length; i++) {
        const dx = points[i]!.position.x - points[i - 1]!.position.x;
        const dy = points[i]!.position.y - points[i - 1]!.position.y;
        dists.push(Math.sqrt(dx * dx + dy * dy));
      }

      const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
      for (const d of dists) {
        expect(d).toBeGreaterThan(avgDist * 0.85);
        expect(d).toBeLessThan(avgDist * 1.15);
      }
    });
  });

  describe('computeTurnControlPoint', () => {
    it('should place control point at tangent intersection for 90° turn', () => {
      // Entry from south heading north, exit heading east
      const entry = { x: 0, y: 0.5 };
      const entryDir = { x: 0, y: -1 };
      const exit = { x: 0.5, y: 0 };
      const exitDir = { x: 1, y: 0 };

      const cp = computeTurnControlPoint(entry, entryDir, exit, exitDir);
      // Lines intersect at (0, 0) — the corner
      expect(cp.x).toBeCloseTo(0);
      expect(cp.y).toBeCloseTo(0);
    });

    it('should return midpoint for straight-through (parallel tangents)', () => {
      const entry = { x: -0.5, y: 0 };
      const entryDir = { x: 1, y: 0 };
      const exit = { x: 0.5, y: 0 };
      const exitDir = { x: 1, y: 0 };

      const cp = computeTurnControlPoint(entry, entryDir, exit, exitDir);
      expect(cp.x).toBeCloseTo(0);
      expect(cp.y).toBeCloseTo(0);
    });
  });
});

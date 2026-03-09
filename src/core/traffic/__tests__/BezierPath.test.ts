import { describe, it, expect } from 'vitest';
import {
  cubicBezierPoint,
  cubicBezierTangent,
  buildArcLengthLUT,
  sampleAtDistance,
  generateTurnControlPoints,
} from '../BezierPath';

describe('BezierPath', () => {
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
      // Straight line: all points collinear
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
      // At t=0, tangent = 3*(p1-p0) = (3, 0)
      expect(t.x).toBeCloseTo(3);
      expect(t.y).toBeCloseTo(0);
    });

    it('should return correct tangent at t=1 (aligned with p2→p3)', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 1, y: 0 };
      const p2 = { x: 1, y: 1 };
      const p3 = { x: 0, y: 1 };
      const t = cubicBezierTangent(p0, p1, p2, p3, 1);
      // At t=1, tangent = 3*(p3-p2) = (-3, 0)
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
      // Straight line of length 3
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
      // Quarter circle curve
      const p0 = { x: 1, y: 0 };
      const p1 = { x: 1, y: 0.55 };
      const p2 = { x: 0.55, y: 1 };
      const p3 = { x: 0, y: 1 };
      const lut = buildArcLengthLUT(p0, p1, p2, p3, 100);
      const totalLength = lut[lut.length - 1]!;

      // Sample 5 equidistant points
      const points = [];
      for (let i = 0; i <= 4; i++) {
        const d = (i / 4) * totalLength;
        points.push(sampleAtDistance(p0, p1, p2, p3, lut, d));
      }

      // Check distances between consecutive points are roughly equal
      const dists = [];
      for (let i = 1; i < points.length; i++) {
        const dx = points[i]!.position.x - points[i - 1]!.position.x;
        const dy = points[i]!.position.y - points[i - 1]!.position.y;
        dists.push(Math.sqrt(dx * dx + dy * dy));
      }

      const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
      for (const d of dists) {
        // Allow 5% tolerance
        expect(d).toBeGreaterThan(avgDist * 0.85);
        expect(d).toBeLessThan(avgDist * 1.15);
      }
    });
  });

  describe('generateTurnControlPoints', () => {
    it('should generate control points for east→north 90° turn', () => {
      const entry = { x: 0.5, y: 0 };
      const entryDir = { x: 1, y: 0 }; // entering from west, heading east
      const exit = { x: 0, y: -0.5 };
      const exitDir = { x: 0, y: -1 }; // exiting to north

      const [cp1, cp2] = generateTurnControlPoints(entry, entryDir, exit, exitDir);
      // cp1 should be ahead of entry (east direction)
      expect(cp1.x).toBeGreaterThan(entry.x);
      // cp2 should be before exit (south of exit, since exit goes north)
      expect(cp2.y).toBeGreaterThan(exit.y);
    });

    it('should generate control points for straight-through (no turn)', () => {
      const entry = { x: -0.5, y: 0 };
      const entryDir = { x: 1, y: 0 };
      const exit = { x: 0.5, y: 0 };
      const exitDir = { x: 1, y: 0 };

      const [cp1, cp2] = generateTurnControlPoints(entry, entryDir, exit, exitDir);
      // For straight-through, control points should be along the line
      expect(cp1.y).toBeCloseTo(0, 1);
      expect(cp2.y).toBeCloseTo(0, 1);
    });
  });
});

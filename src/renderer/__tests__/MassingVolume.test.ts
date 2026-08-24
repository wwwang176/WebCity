import { describe, it, expect } from 'vitest';
import {
  RASTER, maxAbsOf, topOf, overlapOf, centroidOffset,
  rasterise, rotate90, differenceRatio, type Volume,
} from '../geometry/buildings/massing/volume';

const box = (o: Partial<Volume> = {}): Volume =>
  ({ x: 0, z: 0, w: 0.6, d: 0.6, y0: 0, y1: 0.5, ...o });

describe('volume measurement', () => {
  it('should measure the furthest corner from the cell centre', () => {
    // The greatest distance from the cell centre rather than the bounding box's width: an
    // off-centre volume bulges to one side and the width does not show it. That is half of
    // BUG-222.
    expect(maxAbsOf([box()])).toBeCloseTo(0.3, 12);
    expect(maxAbsOf([box({ x: 0.2 })]), '偏心的量體').toBeCloseTo(0.5, 12);
    expect(maxAbsOf([box({ w: 0.4, d: 0.9 })]), '深比寬大').toBeCloseTo(0.45, 12);
  });

  it('should report the tallest point', () => {
    expect(topOf([box({ y1: 0.4 }), box({ y0: 0.4, y1: 0.9 })])).toBeCloseTo(0.9, 12);
  });

  it('should find no overlap between stacked volumes', () => {
    // A podium and a tower share a plane — the tower's base is the podium's top — and contact is
    // not overlap.
    expect(overlapOf(box({ y1: 0.3 }), box({ y0: 0.3, y1: 1.0 }))).toBe(0);
  });

  it('should find no overlap between volumes side by side', () => {
    expect(overlapOf(box({ x: -0.3, w: 0.4 }), box({ x: 0.3, w: 0.2 }))).toBe(0);
  });

  it('should measure the intersection when volumes really do overlap', () => {
    // Overlapping volumes create invisible interior faces: triangles spent for nothing and
    // invisible on screen.
    const a = box({ x: 0, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    const b = box({ x: 0.2, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    expect(overlapOf(a, b)).toBeCloseTo(0.2 * 0.4 * 1, 12);
  });

  it('should call a centred single box symmetric', () => {
    expect(centroidOffset([box()])).toBeCloseTo(0, 12);
  });

  it('should call an L-shape asymmetric', () => {
    // Two wings put the centroid clearly off the bounding box's centre.
    const l: Volume[] = [
      { x: -0.1, z: 0, w: 0.4, d: 0.7, y0: 0, y1: 0.6 },
      { x: 0.2, z: -0.2, w: 0.3, d: 0.3, y0: 0, y1: 0.6 },
    ];
    expect(centroidOffset(l)).toBeGreaterThan(0.04);
  });

  it('should not be fooled by a box that is merely wider than deep', () => {
    // A 7.5 x 8.2 box rotated 90 degrees still reads as the same box. The raster-difference metric
    // does not see it while the centroid does, which is why this metric exists.
    expect(centroidOffset([box({ w: 0.5, d: 0.7 })])).toBeCloseTo(0, 12);
  });
});

describe('silhouette raster', () => {
  it('should record the height of each cell', () => {
    const g = rasterise([box({ w: 1.0, d: 1.0, y1: 0.42 })]);
    expect(g.length).toBe(RASTER * RASTER);
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeCloseTo(0.42, 6);
  });

  it('should leave empty ground at zero', () => {
    const g = rasterise([box({ x: -0.25, w: 0.4, d: 1.0, y1: 0.5 })]);
    // The right half holds no volume.
    expect(g[RASTER * 8 + RASTER - 1]).toBe(0);
    expect(g[RASTER * 8 + 1]).toBeCloseTo(0.5, 6);
  });

  it('should keep the tallest volume when two stack', () => {
    const g = rasterise([box({ y1: 0.3 }), box({ w: 0.2, d: 0.2, y0: 0.3, y1: 0.8 })]);
    expect(g[RASTER * 8 + 8]).toBeCloseTo(0.8, 6);
  });

  it('should rotate a quarter turn', () => {
    const g = rasterise([box({ x: -0.3, w: 0.3, d: 0.9, y1: 0.5 })]);
    const r = rotate90(g);
    expect(r.length).toBe(g.length);
    // After the rotation the bar that hugged the west side is no longer there.
    expect(differenceRatio(g, r, 0.05)).toBeGreaterThan(0.1);
  });

  it('should call a shape identical to itself', () => {
    const g = rasterise([box()]);
    expect(differenceRatio(g, g, 0.05)).toBe(0);
  });

  it('should call a square box unchanged by rotation', () => {
    // Rotating a square box 90 degrees is a no-op, which is the situation the current variants are
    // in.
    const g = rasterise([box({ w: 0.6, d: 0.6 })]);
    expect(differenceRatio(g, rotate90(g), 0.05)).toBe(0);
  });

  it('should ignore height differences below the tolerance', () => {
    // The tolerance is half a storey: 10 cm shorter is not a different shape. The volume fills the
    // whole cell, or the difference ratio's denominator includes open ground and everything looks
    // similar.
    const a = rasterise([box({ w: 1, d: 1, y1: 0.50 })]);
    const b = rasterise([box({ w: 1, d: 1, y1: 0.51 })]);
    expect(differenceRatio(a, b, 0.05)).toBe(0);
    expect(differenceRatio(a, b, 0.005)).toBeGreaterThan(0.9);
  });
});

import { describe, it, expect } from 'vitest';
import { smoothTrackPath } from '../TrainAnimator';

describe('smoothTrackPath with custom radius', () => {
  const corner: { x: number; y: number }[] = [
    { x: 0, y: 0 },   // approach from left
    { x: 1, y: 0 },   // corner
    { x: 1, y: 1 },   // exit upward
  ];

  it('should produce arc points at default radius 0.5', () => {
    const result = smoothTrackPath(corner);
    // Should have more points than the 3 input (arc adds ~7 points replacing the corner)
    expect(result.length).toBeGreaterThan(3);
    // First and last points preserved
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it('should produce arc points at custom radius 0.25', () => {
    const result = smoothTrackPath(corner, 0.25);
    expect(result.length).toBeGreaterThan(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it('should produce tighter arc with smaller radius', () => {
    const big = smoothTrackPath(corner, 0.5);
    const small = smoothTrackPath(corner, 0.2);

    // Both should have arc points, but the small radius arc should be closer to the corner
    // Find the arc point closest to the original corner (1, 0)
    const closestBig = Math.min(...big.map(p => Math.sqrt((p.x - 1) ** 2 + p.y ** 2)));
    const closestSmall = Math.min(...small.map(p => Math.sqrt((p.x - 1) ** 2 + p.y ** 2)));

    // Smaller radius → arc passes closer to the original corner
    expect(closestSmall).toBeLessThan(closestBig);
  });

  it('should keep straight segments unchanged', () => {
    const straight: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const result = smoothTrackPath(straight, 0.3);
    // No direction change → no arc → all points kept as-is
    expect(result.length).toBe(3);
    expect(result).toEqual(straight);
  });

  it('should handle radius=0.14 (S airport tight turns)', () => {
    // Simulate S airport taxiway: short segment between two corners
    const tight: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 0.28, y: 0 },   // short horizontal
      { x: 0.28, y: 0.28 }, // corner: turn up
      { x: 0, y: 0.28 },    // corner: turn left
    ];
    const result = smoothTrackPath(tight, 0.14);
    expect(result.length).toBeGreaterThan(4);
    // First and last preserved
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 0, y: 0.28 });
  });

  it('should produce same result as default when radius=0.5', () => {
    const defaultResult = smoothTrackPath(corner);
    const explicitResult = smoothTrackPath(corner, 0.5);
    expect(explicitResult).toEqual(defaultResult);
  });
});

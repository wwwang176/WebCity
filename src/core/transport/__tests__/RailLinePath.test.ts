import { describe, it, expect } from 'vitest';
import { buildRailLinePath, interpolateRailPath } from '../RailLinePath';

describe('RailLinePath', () => {
  // --- buildRailLinePath ---

  it('should return empty path for no segments', () => {
    const path = buildRailLinePath([]);
    expect(path.segments).toHaveLength(0);
    expect(path.totalLength).toBe(0);
  });

  it('should build path from one segment (2 stations)', () => {
    // Station A at (0,0), Station B at (3,0): straight horizontal track
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],   // A → B
      ['3,0', '2,0', '1,0', '0,0'],   // B → A (round trip)
    ]);

    expect(path.segments).toHaveLength(2);
    expect(path.totalLength).toBe(6); // 3 + 3
    expect(path.stationDistances).toEqual([0, 3]);
  });

  it('should build path from loop route (3 stations)', () => {
    // Triangle: (0,0) → (3,0) → (3,3) → (0,0)
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],                      // A → B (length 3)
      ['3,0', '3,1', '3,2', '3,3'],                      // B → C (length 3)
      ['3,3', '2,3', '1,3', '0,3', '0,2', '0,1', '0,0'], // C → A (length 6)
    ]);

    expect(path.segments).toHaveLength(3);
    expect(path.stationDistances).toEqual([0, 3, 6]);
    expect(path.totalLength).toBe(12);
  });

  it('should compute correct segment lengths for diagonal path', () => {
    // Diagonal: (0,0) → (1,1) → (2,2)
    const path = buildRailLinePath([
      ['0,0', '1,1', '2,2'],
    ]);

    const expectedLen = Math.SQRT2 * 2;
    expect(path.segments[0]!.length).toBeCloseTo(expectedLen, 5);
  });

  // --- interpolateRailPath ---

  it('should interpolate at the start', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],
      ['3,0', '2,0', '1,0', '0,0'],
    ]);

    const pos = interpolateRailPath(path, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('should interpolate at midpoint', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],
      ['3,0', '2,0', '1,0', '0,0'],
    ]);

    const pos = interpolateRailPath(path, 1.5);
    expect(pos.x).toBeCloseTo(1.5);
    expect(pos.y).toBeCloseTo(0);
  });

  it('should interpolate at station B (end of first segment)', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],
      ['3,0', '2,0', '1,0', '0,0'],
    ]);

    const pos = interpolateRailPath(path, 3);
    expect(pos.x).toBeCloseTo(3);
    expect(pos.y).toBeCloseTo(0);
  });

  it('should interpolate on return trip', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],
      ['3,0', '2,0', '1,0', '0,0'],
    ]);

    // 4.5 = 3 (first segment) + 1.5 into return
    const pos = interpolateRailPath(path, 4.5);
    expect(pos.x).toBeCloseTo(1.5);
    expect(pos.y).toBeCloseTo(0);
  });

  it('should wrap around on loop', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '3,0'],
      ['3,0', '2,0', '1,0', '0,0'],
    ]);

    // distance = totalLength should wrap to 0
    const pos = interpolateRailPath(path, 6);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('should compute correct heading for eastward movement', () => {
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0'],
    ]);

    const pos = interpolateRailPath(path, 0.5);
    expect(pos.heading).toBeCloseTo(0); // east = 0 radians
  });

  it('should compute correct heading for southward movement', () => {
    const path = buildRailLinePath([
      ['0,0', '0,1', '0,2'],
    ]);

    const pos = interpolateRailPath(path, 0.5);
    // heading = atan2(-(1-0), 0-0) = atan2(-1, 0) = -PI/2
    expect(pos.heading).toBeCloseTo(-Math.PI / 2);
  });

  it('should return zero position for empty path', () => {
    const path = buildRailLinePath([]);
    const pos = interpolateRailPath(path, 5);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('should interpolate on an L-shaped track', () => {
    // Track goes east then south: (0,0)→(1,0)→(2,0)→(2,1)→(2,2)
    const path = buildRailLinePath([
      ['0,0', '1,0', '2,0', '2,1', '2,2'],
    ]);

    // At distance 2.5: past the corner, 0.5 into the southward portion
    const pos = interpolateRailPath(path, 2.5);
    expect(pos.x).toBeCloseTo(2);
    expect(pos.y).toBeCloseTo(0.5);
  });
});

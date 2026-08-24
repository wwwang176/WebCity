import { describe, it, expect } from 'vitest';
import { TARGET_HEIGHTS_M } from '../geometry/buildings/registry';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

/**
 * Heights are a table in metres rather than a scale factor multiplied onto the geometry. As a scale
 * factor the meaning was opaque and unrelated to the population housed: a 4-person Small House came
 * out at 2.4 m, under one storey, and a 320-person High Rise at 33.7 m, eleven storeys. These cases
 * assert that what is drawn really is the height the table names.
 */
describe('TARGET_HEIGHTS_M', () => {
  it('should cover every zone and density that has buildings', () => {
    for (const key of ['1:LOW', '2:HIGH', '3:LOW', '4:HIGH', '5:LOW', '6:LOW', '6:HIGH']) {
      expect(TARGET_HEIGHTS_M[key], `missing ${key}`).toBeDefined();
      expect(TARGET_HEIGHTS_M[key]).toHaveLength(3);
    }
  });

  it('should grow with level in every bucket', () => {
    for (const [key, heights] of Object.entries(TARGET_HEIGHTS_M)) {
      expect(heights[1], `${key} L2 not taller than L1`).toBeGreaterThan(heights[0]!);
      expect(heights[2], `${key} L3 not taller than L2`).toBeGreaterThan(heights[1]!);
    }
  });

  it('should give a four-person house at least one full storey', () => {
    // 2.4 m as a scale factor is 0.8 of a storey.
    expect(TARGET_HEIGHTS_M['1:LOW']![0]).toBeGreaterThanOrEqual(4.5);
  });

  it('should make a high rise a tower, not a block', () => {
    // 320 people is 220 m taken literally. How far that is compressed is visual tuning and gets
    // adjusted repeatedly, so the assertion is the intent — clearly taller than the footprint is
    // wide — not a tuned number. A tuned value written into the test has to be edited on every
    // adjustment, and the test becomes friction rather than protection.
    expect(TARGET_HEIGHTS_M['2:HIGH']![2]).toBeGreaterThanOrEqual(METRES_PER_CELL * 3);
  });

  it('should keep the office tower above the office block', () => {
    // BUG-220: high-density offices house 160/320/600 people, low-density ones 15/30/50.
    for (const lv of [0, 1, 2]) {
      expect(TARGET_HEIGHTS_M['6:HIGH']![lv]).toBeGreaterThan(TARGET_HEIGHTS_M['6:LOW']![lv]!);
    }
  });
});

// heightScaleFor no longer exists: the generator emits final heights directly. MassingGeometry's
// `should reach the height the table asks for` covers drawing the height the table names, and
// MassingDimensions' `should use every height option across the eight variants` covers each variant
// having its own height.

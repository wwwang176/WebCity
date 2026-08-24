import { describe, it, expect } from 'vitest';
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS, M,
} from '../geometry/buildings/massing/metrics';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

/**
 * These constants live in a leaf module because propBands imports massing, and holding them in
 * propBands would close a cycle.
 */
describe('massing metrics', () => {
  it('should agree with the shared building width constant', () => {
    // The envelope and SidewalkGraph's BUILDING_HALF_SIZE are the same line (BUG-221); a separate
    // number drifts.
    expect(HALF_ENVELOPE).toBeCloseTo(MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2, 12);
  });

  it('should convert metres to cells', () => {
    expect(M(12)).toBeCloseTo(1, 12);
    expect(M(2.2)).toBeCloseTo(OVERHEAD_CLEARANCE, 12);
  });

  it('should keep the pedestrian envelope inside the cell', () => {
    expect(HALF_ENVELOPE).toBeLessThan(CELL_EDGE);
  });

  it('should put the shopfront ceiling at the lowest floor the shader draws', () => {
    // Floor height comes from the variant while an overhang's geometry is shared across the whole
    // bucket, so only the minimum guarantees it never rises past the ground floor.
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
    expect(FLOOR_HEIGHT_UNITS.MIN).toBeLessThan(FLOOR_HEIGHT_UNITS.MAX);
  });

  it('should leave room between head clearance and the shopfront ceiling', () => {
    expect((SHOPFRONT_CEILING - OVERHEAD_CLEARANCE) * METRES_PER_CELL)
      .toBeGreaterThan(0.3);
  });

  it('should stack the ground layers in drawing order', () => {
    // Markings sit above the paving and glows above the markings; reversed, they z-fight.
    expect(GROUND_LAYERS.MARKING).toBeGreaterThan(GROUND_LAYERS.DECAL);
    expect(GROUND_LAYERS.LIGHT_SPOT).toBeGreaterThan(GROUND_LAYERS.MARKING);
    for (const [name, y] of Object.entries(GROUND_LAYERS)) {
      expect(y, `${name} 陷進地面`).toBeGreaterThan(0);
      expect(y * METRES_PER_CELL, `${name} 浮空`).toBeLessThan(0.1);
    }
  });
});

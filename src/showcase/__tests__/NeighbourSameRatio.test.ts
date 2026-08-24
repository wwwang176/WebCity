import { describe, it, expect } from 'vitest';
import { blockCells, matrixCells, neighbourSameRatio, densityFor } from '../views';
import { getMassingVariants } from '../../renderer/geometry/buildings/massing';
import type { Density } from '../../renderer/geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';
import { ZONE_TYPES, LEVELS } from '../../renderer/geometry/buildings/registry';

/**
 * "It looks repetitive" is subjective; "the building next door is identical to mine" is not. This
 * ratio is the machine-checkable form of acceptance condition 7.1.
 */
describe('neighbourSameRatio', () => {
  it('should report 1 when every cell is identical', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should report 0 when no two neighbours share a variant', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 1, facadeSeed: [0.5, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 2, facadeSeed: [0.7, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 3, facadeSeed: [0.9, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(0);
  });

  it('should count a shared variant as the same even when the facade seed differs', () => {
    // Facade changes leave the silhouettes unchanged, and this metric has to keep showing the
    // silhouettes as repetitive, or facade work masks whether the massing work landed.
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0.1, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0.9, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should return 0 for fewer than two cells', () => {
    expect(neighbourSameRatio([])).toBe(0);
  });
});

describe('blockCells', () => {
  it('should fill the requested square', () => {
    expect(blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8)).toHaveLength(64);
  });

  it('should give each cell the appearance its coordinates imply', () => {
    const a = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8);
    const b = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8);
    expect(a).toEqual(b);
  });

  it('should change when the seed byte changes', () => {
    const a = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8, 0);
    const b = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8, 7);
    expect(a).not.toEqual(b);
  });

  it('should keep the street below the repetition threshold', () => {
    // Eight generated variants plus neighbour avoidance measure 3.37%, against 33.4% before.
    //
    // 24x24 rather than 8x8: a small block gives only 112 pairs, where one or two swing the figure by
    // a percentage point.
    for (const zone of [ZoneType.RESIDENTIAL_LOW, ZoneType.COMMERCIAL_HIGH]) {
      const density = zone === ZoneType.COMMERCIAL_HIGH ? 'HIGH' : 'LOW';
      const ratio = neighbourSameRatio(blockCells(zone, density, 1, 24));
      expect(ratio, `zone ${zone} 相鄰重複 ${(ratio * 100).toFixed(1)}%`).toBeLessThan(0.05);
    }
  });
});

describe('matrixCells', () => {
  it('should include every zone at every level', () => {
    const cells = matrixCells();
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(cells.some(c => c.zoneType === zone && c.level === level),
          `matrix is missing zone ${zone} level ${level}`).toBe(true);
      }
    }
  });
});

describe('densityFor', () => {
  it('should never leave a zone with nothing to draw', () => {
    // BUG-227: changing zone in the showcase redrew with the **previous** zone's density, because
    // syncDensity sat on a second change listener and the first had already called onChange. High
    // residential has only HIGH and low commercial only LOW, so a mismatch gives zero variants and a
    // blank view.
    for (const zone of ZONE_TYPES) {
      for (const preferred of ['LOW', 'HIGH'] as Density[]) {
        const d = densityFor(zone, preferred);
        for (const level of LEVELS) {
          expect(getMassingVariants(zone, d, level).length,
            `zone ${zone} 偏好 ${preferred} -> ${d} L${level}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should keep the preferred density when the zone has it', () => {
    // Offices have both and must not be substituted, or the user selects high density and sees low.
    expect(densityFor(ZoneType.OFFICE, 'LOW')).toBe('LOW');
    expect(densityFor(ZoneType.OFFICE, 'HIGH')).toBe('HIGH');
  });
});
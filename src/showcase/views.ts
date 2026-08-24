/**
 * The showcase's view modes. The block is the important one: repetitiveness surfaces only with a group
 * of buildings on screen at once, and against a single house even three variants feel like enough.
 */
import { appearanceOf } from '../renderer/BuildingAppearance';
import {
  LEVELS, TARGET_HEIGHTS_M, heightKey, type Density,
} from '../renderer/geometry/buildings/registry';
import { getMassingVariants, VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { ZoneType } from '../core/grid/types';

/**
 * `civic` differs from the other three: it draws no zoned buildings, so the zone, density, level and
 * variant controls all mean nothing in that mode (see the hiding logic in `controls.ts`).
 */
export type ViewMode = 'single' | 'block' | 'matrix' | 'civic';

/**
 * Which density a zone uses.
 *
 * Only offices have buildings at both densities. A mismatched density on any other zone gives **zero
 * variants**: nothing on screen, and nothing reporting it (BUG-227).
 */
export function densityFor(zoneType: number, preferred: Density): Density {
  if (TARGET_HEIGHTS_M[heightKey(zoneType, preferred)]) return preferred;
  return TARGET_HEIGHTS_M[heightKey(zoneType, 'LOW')] ? 'LOW' : 'HIGH';
}

export interface PlacedCell {
  x: number;
  z: number;
  zoneType: number;
  density: Density;
  level: number;
  variantIndex: number;
  facadeSeed: readonly [number, number, number];
}

function cellAt(
  zoneType: number, density: Density, level: number, x: number, z: number, seedByte = 0,
): PlacedCell {
  const app = appearanceOf({
    x, y: z, zoneType, level, seedByte,
    variantCount: VARIANT_COUNT,
    paletteSize: 8,
  });
  return { x, z, zoneType, density, level, variantIndex: app.variantIndex, facadeSeed: app.facadeSeed };
}

/** A size by size block of one zone at one level, centred on the origin. */
export function blockCells(
  zoneType: number, density: Density, level: number, size: number, seedByte = 0,
): PlacedCell[] {
  const half = Math.floor(size / 2);
  const out: PlacedCell[] = [];
  for (let z = -half; z < size - half; z++) {
    for (let x = -half; x < size - half; x++) {
      out.push(cellAt(zoneType, density, level, x, z, seedByte));
    }
  }
  return out;
}

/** Every variant of each (zone, level) laid out in a row, so all the combinations can be scanned at a glance. */
export function matrixCells(): PlacedCell[] {
  const out: PlacedCell[] = [];
  let row = 0;
  // Walks every (zone, density) in the height table, so that both of the office densities appear.
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zoneStr, densityStr] = key.split(':');
    const zoneType = Number(zoneStr);
    const density = densityStr as Density;
    if (zoneType === ZoneType.NONE) continue;
    for (const level of LEVELS) {
      const variants = getMassingVariants(zoneType, density, level);
      for (let i = 0; i < variants.length; i++) {
        out.push({
          x: i * 2, z: row * 2, zoneType, density, level,
          variantIndex: i, facadeSeed: [0.5, 0.5, 0.5],
        });
      }
      row++;
    }
  }
  return out;
}

/**
 * The share of four-way adjacent pairs that share a variant.
 *
 * It deliberately looks at variantIndex alone and not facadeSeed: identical silhouettes are the main
 * cause of looking repetitive, and facade differences do not cover them. Facade work therefore leaves
 * this number unchanged, which is correct rather than a broken metric.
 */
export function neighbourSameRatio(cells: PlacedCell[]): number {
  if (cells.length < 2) return 0;
  const byKey = new Map<string, PlacedCell>();
  for (const c of cells) byKey.set(`${c.x},${c.z}`, c);

  let pairs = 0;
  let same = 0;
  for (const c of cells) {
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const n = byKey.get(`${c.x + dx},${c.z + dz}`);
      if (!n) continue;
      pairs++;
      if (n.variantIndex === c.variantIndex && n.zoneType === c.zoneType && n.level === c.level) {
        same++;
      }
    }
  }
  return pairs === 0 ? 0 : same / pairs;
}

import type * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * Buildings' dimension tables and shared types.
 *
 * The massing geometry itself lives in `massing/`, where parameterised generators replaced
 * seventeen hand-written variants and six scaling functions. What remains here are the tables
 * derived from the game's own numbers — target heights, target widths — and how a bucket is
 * identified.
 */

/** A function producing one geometry. A bucket calls it once at creation. */
export type GeoBuilder = () => THREE.BufferGeometry;

export const LEVELS = [1, 2, 3] as const;

/** Triangle limits. The showcase's counter marks both lines. */
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
  /**
   * Ground props are budgeted separately: they are their own layer, take nothing from the massing
   * budget, and at range setting that layer's count to 0 makes them free (spec section 4.6).
   *
   * 240 was set when the vocabulary was residential hedges alone. With twelve piece types across
   * every zone, the measured maximum is 272, on high-density residential L3. 320 leaves 20%
   * headroom. The primitives' segment counts have already been trimmed once — bollards became
   * square posts and spheres lost segments — and cutting below 240 starts to hurt the look, while
   * this project's trade-off favours appearance over performance.
   */
  PROP: 320,
} as const;

// ===== Height ranges per zone =====

export type Density = 'LOW' | 'HIGH';

/** The height table's key: zone plus density. The office zone's two densities differ elevenfold in population (BUG-220). */
export function heightKey(zoneType: number, density: Density): string {
  return `${zoneType}:${density}`;
}

/**
 * Target heights in **metres** for each (zone, density) at all three levels.
 *
 * Derived from the population they hold: 3 m per storey, 6 m for industry; plot coverage of 60%
 * at low density, 85% at high density and 70% for industry; floor area per person of 35 m2 for
 * low-density residential, 28 for high-density residential, 30 for commercial, 40 for industrial
 * and 15 for office.
 *
 * Low density follows the arithmetic directly. High density is compressed: 320 people in a 144 m2
 * cell is three times real density, and taken literally an L3 residential tower needs 220 m,
 * eighteen times its footprint width, leaving a whole district looking like a bed of nails.
 * Compressed, a high-density building's visual density is lower than the population it holds —
 * a deliberate trade-off, and reconciling the two means changing the game's population numbers
 * rather than the rendering (spec revision 1).
 *
 * High density was reduced twice: 30/51/75 to 22/36/52 to 22/32/42 for high-density residential,
 * with the others following. The second pass touched only L2 and L3 and left L1 alone, because
 * the "too tall" impression concentrates at the top levels. Low-density residential and
 * commercial were untouched throughout: they follow the arithmetic already.
 *
 * Low-density office was raised from 9/15/24 to 12/18/24: a 9 m office block looks stunted beside
 * high density. Stopping L3 at 24 m is deliberate — low-density office L3 holds 50 people and
 * high-density office L1 holds 160, so raising the former further inverts the ladder.
 *
 * Industry was reduced at all three levels (8/12/16 to 7/10/13 to 6/7.5/9) with the footprint
 * pushed to the limit. Modern plants are almost all single-storey with high ceilings, covering the
 * plot, and multi-storey factories are rare, so industry's level ladder should not show in height:
 * it should show in stacks, silos, pipe racks and containers, which is the roof and ground-prop
 * work.
 */
export const TARGET_HEIGHTS_M: Record<string, [number, number, number]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   [5, 7, 10],
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [22, 32, 42],
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    [5, 8, 12],
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  [18, 27, 36],
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        [6, 7.5, 9],
  [heightKey(ZoneType.OFFICE, 'LOW')]:            [12, 18, 24],
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           [24, 36, 48],
};

/**
 * The zones that have buildings. Derived from the height table: the masses come from generators,
 * and the height table is what "which zones have buildings" amounts to.
 */
export const ZONE_TYPES: number[] = [
  ...new Set(Object.keys(TARGET_HEIGHTS_M).map(k => Number(k.split(':')[0]))),
];

/**
 * Target footprint widths in **metres** for each (zone, density).
 *
 * Each of the eight variants takes an actual width between 85% and 100% of the target, and the
 * narrowest and widest wall faces are **measured** (see `propBands`) rather than derived from a
 * jitter formula.
 *
 * The ceiling is `MAX_BUILDING_WIDTH_M` at 9.8 m: pedestrian door and walkway nodes sit outside
 * the building's wall, and anything wider sends pedestrians into the building (BUG-221). That
 * constant is shared with SidewalkGraph.
 *
 * At a uniform 7 to 8 m covering 60% of the cell, a 42 m residential tower is a 5.5:1 needle, and
 * half of "it looks too tall" is that it is too thin. Real towers cover almost their whole plot.
 *
 * Low-density residential is 6.0 rather than 7.2: 7.2 measured the bounding box of house plus
 * garage plus tree, where the house itself was only 4.3 m. With the yard objects moved to their
 * own layer, keeping 7.2 as the target would inflate the house to 7.2 m and leave the yard 0.76 m.
 *
 * Widths were trimmed once more: low-density commercial and office from 8.4 to 7.8 (7%), and the
 * plot-filling types from 9.8 to 9.0 (8%). That gives every zone a low-prop band of at least
 * 0.4 m, which holds bollards, bins, bike racks and hydrants; before, those zones' bands were
 * 0.07 m or nothing, and held nothing at all.
 */
export const TARGET_WIDTHS_M: Record<string, number> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   6.0,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: 9.0,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    7.8,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  9.0,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        9.0,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            7.8,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           9.0,
};

/**
 * A variant bucket's complete identity. All four dimensions are required — zone, density, level
 * and variant index: without density, the office zone's 15-person and 160-person buildings share a
 * bucket (BUG-220), and without level, upgrading can only scale.
 */
export function bucketKey(
  zoneType: number, density: Density, level: number, variantIndex: number,
): string {
  return `${zoneType}_${density}_${level}_${variantIndex}`;
}

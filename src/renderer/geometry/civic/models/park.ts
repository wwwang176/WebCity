import {
  FACADE_GREEN, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * Park — 1x1 cells = 12 x 12 m. The smallest civic facility in the project.
 *
 * With only +/-5.76 m of usable range it has no building at all: a pavilion, a cross of paths,
 * four patches of grass and a ring of trees. That is what a park should be — **the ground is the
 * subject and the masses are secondary**.
 *
 * Being small, it is also the one civic facility placed in bulk at 200 per cell, so triangles
 * matter. A park with twenty trees appearing thirty times in a city costs thirty times over.
 *
 * ```
 *        │
 *  grass │ grass
 *   ─────┼─────   cross paths, all four ends reaching the cell boundary
 *  grass │ grass
 *        │
 *    central pavilion
 * ```
 */

/** The pavilion's post tops. The roof starts here. */
const EAVE = M(2.7);
/** The path's half-width. */
const PATH_HALF = 0.9;
/** Half the cell's edge in metres. Decals reach it with no inset: a sidewalk runs all the way to the kerb. */
const HALF = 6.0;

const massing: CivicVolume[] = [
  // The pavilion's plinth. It takes `PART_GROUND` plus `shade` because it is **paving**, not a
  // wall; tagged as wall, a 0.25 m platform grows windows.
  {
    tag: 'deck', part: PART_GROUND, shade: 0.62, shape: 'cylinder',
    x: 0, z: 0, w: M(3.8), d: M(3.8), y0: 0, y1: M(0.25),
  },
  // A two-stage tapering roof. `cylinder` is an octagonal prism, and two stacked read as a
  // pyramidal roof.
  {
    tag: 'gazeboRoof', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: 0, w: M(4.4), d: M(4.4), y0: EAVE, y1: M(3.1),
  },
  {
    tag: 'gazeboRoof', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: 0, w: M(2.6), d: M(2.6), y0: M(3.1), y1: M(3.5),
  },
  {
    // The light inside the pavilion. At night it is all the park has; without it the park is a
    // patch of black ground.
    tag: 'finial', part: PART_LAMP, shape: 'cylinder',
    x: 0, z: 0, w: M(0.5), d: M(0.5), y0: M(3.5), y1: M(3.9),
  },
];

/**
 * The ground: four patches of grass plus a cross of paths.
 *
 * All four ends of the paths reach the cell boundary; a park that cannot be walked into is a
 * decorative lawn. Base decals may not overlap, so the grass is cut into four and the east-west
 * path is two pieces, with the middle square belonging to the north-south one.
 */
const decals: CivicDecal[] = [
  { x: 0, z: 0, w: M(PATH_HALF * 2), d: M(HALF * 2), shade: 0.62 },
];

for (const side of [-1, 1]) {
  decals.push({
    x: M(side * (PATH_HALF + HALF) / 2), z: 0,
    w: M(HALF - PATH_HALF), d: M(PATH_HALF * 2), shade: 0.62,
  });
  for (const sz of [-1, 1]) {
    decals.push({
      x: M(side * (PATH_HALF + HALF) / 2), z: M(sz * (PATH_HALF + HALF) / 2),
      w: M(HALF - PATH_HALF), d: M(HALF - PATH_HALF), shade: 0.0, lawn: true,
    });
  }
}

/** The pavilion's four posts and four benches. `geometry/props` has neither. */
const props: CivicVolume[] = [
  ...([[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'post', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(0.16), d: M(0.16), y0: M(0.25), y1: EAVE,
    })),
  // Benches face along the paths, with their backs to the grass.
  ...([[-2.6, 1.5, 'x'], [2.6, 1.5, 'x'], [-2.6, -1.5, 'x'], [2.6, -1.5, 'x']] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'bench', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(1.6), d: M(0.5), y0: M(0.3), y1: M(0.45),
    })),
];

/**
 * Planting. Almost all of a park's triangles go here: it is what the building is.
 *
 * Trees go on the four patches of grass, never on the paths.
 */
const fixtures: PropSpec[] = [
  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'tree' as const,
    x: M(sx * 3.6), z: M(sz * 3.6), heightM: 7.0, crownRadius: M(1.5),
  }))),
  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'tree' as const,
    x: M(sx * 4.6), z: M(sz * 1.6), heightM: 5.2, crownRadius: M(1.0),
  }))),

  ...([-1, 1] as const).flatMap(sx => ([-1, 1] as const).map(sz => ({
    kind: 'shrub' as const, x: M(sx * 1.8), z: M(sz * 4.8), radius: M(0.7),
  }))),
  { kind: 'flowerBed', x: M(-4.8), z: M(4.8), radius: M(0.7) },
  { kind: 'flowerBed', x: M(4.8), z: M(4.8), radius: M(0.7) },
  { kind: 'topiary', x: M(-4.8), z: M(-4.8), radius: M(0.7) },
  { kind: 'topiary', x: M(4.8), z: M(-4.8), radius: M(0.7) },

  // Two lamps along the paths. The pavilion's light does not reach the entrances.
  { kind: 'lamp', x: M(-1.3), z: M(4.2), heightM: 3.6 },
  { kind: 'lamp', x: M(1.3), z: M(-4.2), heightM: 3.6 },
  { kind: 'bin', x: M(1.3), z: M(4.2), radius: M(0.24) },
  { kind: 'signPost', x: M(-1.3), z: M(-4.2), axis: 'z' },
];

/**
 * `aSeed`.
 *
 * A park has no walls, so `.x`, the floor rhythm, affects nothing here and takes a middle value.
 * `.z` is the material variation and does affect the pavilion light's brightness.
 */
const SEED = [0.5, 0.66, 0.55] as const;

export const parkPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_GREEN,
  color: civicColorOf('park'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead: [],
  fixtures,
  // A 12 x 12 m park has no car park and should not: it is reached on foot.
  vehicles: [],
};

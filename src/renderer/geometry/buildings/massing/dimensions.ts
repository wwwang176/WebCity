import { M, FLOOR_HEIGHT_UNITS } from './metrics';
import { variantRng } from './rng';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, heightKey, type Density } from '../registry';

/**
 * The number of variants per (zone, density, level).
 *
 * Eight is the compromise between adjacent-repeat rate and bucket count: with a plain per-cell
 * hash the repeat rate is 1/V, so eight gives 12.5%, and only neighbour avoidance on top brings it
 * under 5%. More variants only push draw calls up linearly.
 */
export const VARIANT_COUNT = 8;

/** How many storey heights are sampled between MIN and MAX. Five lets even low buildings reach two or three distinct heights. */
const FLOOR_SAMPLES = 5;

const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;

export interface HeightOption {
  floors: number;
  /** 格 */
  floorHeight: number;
  /** floors x floorHeight, in cells. */
  height: number;
}

function floorHeightSample(s: number): number {
  return FLOOR_HEIGHT_UNITS.MIN
    + (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN) * s / (FLOOR_SAMPLES - 1);
}

/**
 * The (floor count, storey height) combinations that reach a target height, sorted by height.
 *
 * **The tolerance scales with the height**: `max(10% of target, one storey)`. A fixed percentage
 * is the wrong model, because a height has to be an integer number of storeys times a storey
 * height, and for a low building one storey is a large share of the target: low-density
 * residential L1 targets 5 m, and +/-10% gives [4.5, 5.5], which holds exactly one combination,
 * 2 storeys of 2.64 m, leaving all eight variants the same height. On a 42 m tower one more storey
 * is 8%, where a percentage does bite.
 *
 * "At least one storey wide" is the whole reason for the rule: a tolerance narrower than one
 * storey means nothing in a world of integer storeys.
 */
export function heightOptions(targetUnits: number): HeightOption[] {
  const tolerance = Math.max(0.1 * targetUnits, MID_FLOOR);
  const lo = targetUnits - tolerance;
  const hi = targetUnits + tolerance;

  const out: HeightOption[] = [];
  for (let floors = 1; floors <= 64; floors++) {
    for (let s = 0; s < FLOOR_SAMPLES; s++) {
      const floorHeight = floorHeightSample(s);
      const height = floors * floorHeight;
      if (height >= lo && height <= hi) out.push({ floors, floorHeight, height });
    }
  }

  // With the tolerance floored at one storey, an empty list is unreachable: `1 storey x MIN`
  // always falls within [target - one storey, target + one storey], because MIN is below a
  // storey's midpoint. An empty list means someone narrowed the tolerance, and failing on the spot
  // is a hundred times easier to track down than handing the caller undefined and failing
  // elsewhere.
  if (out.length === 0) {
    throw new Error(`目標高度 ${targetUnits} 湊不出任何整數層組合`);
  }

  out.sort((a, b) => a.height - b.height);
  return out;
}

export interface Dimensions {
  /** Footprint width and depth, in cells. */
  w: number;
  d: number;
  floors: number;
  /** 格 */
  floorHeight: number;
  /** floors x floorHeight, in cells. */
  height: number;
}

/**
 * This variant's dimensions. Returns null when this (zone, density) has no buildings.
 *
 * Heights are **spread in layers** across every feasible combination rather than sampled at
 * random, since random sampling can crowd all eight into the middle. Footprint width and depth
 * each take 85% to 100% of the target: below 85% the forecourt paving pulls away from the wall's
 * foot, which is the cause of BUG-226.
 */
export function dimensionsFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Dimensions | null {
  const key = heightKey(zoneType, density);
  const heights = TARGET_HEIGHTS_M[key];
  const targetW = TARGET_WIDTHS_M[key];
  if (!heights || targetW === undefined) return null;

  const lv = Math.max(1, Math.min(3, level));
  const opts = heightOptions(M(heights[lv - 1]!));
  const opt = opts[Math.floor((variantIndex / VARIANT_COUNT) * opts.length) % opts.length]!;

  const rng = variantRng(zoneType, density, level, variantIndex);
  const full = M(targetW);
  return {
    w: full * (0.85 + 0.15 * rng()),
    d: full * (0.85 + 0.15 * rng()),
    floors: opt.floors,
    floorHeight: opt.floorHeight,
    height: opt.height,
  };
}

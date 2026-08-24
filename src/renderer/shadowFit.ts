import { METRES_PER_CELL } from '../core/grid/constants';

/**
 * The shadow camera's depth range, and both biases converted into an offset on the ground.
 *
 * Pure arithmetic with no Three.js import. Every number here is the computable-but-invisible kind:
 * a wrong bias shows up only as a shadow sitting a little away from its object, or as stripes
 * across the ground, and neither reports anything. BUG-234 was first fixed on the wrong term,
 * because the derivation lived in someone's head rather than in the code.
 */

/** Buildings reach 48 m = 4 cells. A caster's height above the focus plane counts toward the depth range. */
export const MAX_CASTER_HEIGHT = 4;

/**
 * The shadow camera's near and far.
 *
 * The depth range encloses the casters exactly and no wider: `shadow.bias` is a value in [0, 1]
 * depth space, and converting it to a world distance **multiplies by (far - near)**. The wider it
 * opens, the further the same bias pushes and the further the shadow sits from its object. A
 * hard-coded 1 / 200 gives 199 cells = 2388 m of depth while the light is only about 107 cells from
 * the focus.
 *
 * @param lightDistance The light-to-focus distance, in cells.
 * @param padded        The shadow camera's half-width in cells, already including margin for
 *                      off-screen casters.
 */
export function shadowDepthRange(
  lightDistance: number, padded: number,
): { near: number; far: number } {
  const span = padded + MAX_CASTER_HEIGHT;
  return {
    // It cannot be 0 or below: a negative near on an orthographic camera is meaningless and unbalances
    // the depth precision.
    near: Math.max(1, lightDistance - span),
    far: lightDistance + span,
  };
}

/**
 * How far a shadow sits from its object on the ground, in metres.
 *
 * The two biases have entirely different geometry:
 *
 *   normalBias pushes along the receiving surface's normal. The ground's normal points up, so
 *              raising by h slides the shadow along the ground by `h / tan(elevation)`.
 *   bias       pushes in depth space, which moves the receiving point along the **light axis**
 *              toward the light by `bias * (far - near)`. That displacement has both a horizontal
 *              and a vertical component and both push the shadow away, for about
 *              `2d * cos(elevation)` in total.
 *
 * The lower the sun the smaller the `tan`, so the worst case is dawn and dusk rather than noon.
 */
export function shadowOffsetMetres(opts: {
  normalBias: number;
  depthBias: number;
  near: number;
  far: number;
  sunElevationRad: number;
}): number {
  const { normalBias, depthBias, near, far, sunElevationRad } = opts;
  const fromNormal = normalBias / Math.tan(sunElevationRad);
  const alongLight = Math.abs(depthBias) * (far - near);
  const fromDepth = 2 * alongLight * Math.cos(sunElevationRad);
  return (fromNormal + fromDepth) * METRES_PER_CELL;
}

/**
 * How WeatherRenderer places the sun, extracted as a pure function so the shadow arithmetic can
 * read it.
 *
 * `sunY` is floored at `80 x 0.1`: the sun never actually reaches the horizon, or shadows would be
 * infinitely long. That floor decides the **worst elevation**, and the shadow's offset is largest
 * exactly there.
 */
export function sunElevationRad(dayFraction: number): number {
  const sunAngle = dayFraction * Math.PI * 2 - Math.PI / 2;
  const sunFactor = Math.max(0, Math.sin(sunAngle));
  const y = 80 * Math.max(0.1, sunFactor);
  const x = 50 * Math.cos(sunAngle);
  return Math.atan2(y, Math.hypot(x, 50));
}

/** The lowest sun of the day: the worst case for shadow offset. */
export function worstSunElevationRad(): number {
  let worst = Infinity;
  for (let i = 0; i <= 200; i++) worst = Math.min(worst, sunElevationRad(i / 200));
  return worst;
}

import { describe, it, expect } from 'vitest';
import { SCENE } from '../SceneManager';
import {
  shadowDepthRange, shadowOffsetMetres, sunElevationRad, worstSunElevationRad,
  MAX_CASTER_HEIGHT,
} from '../shadowFit';
import { METRES_PER_CELL } from '../../core/grid/constants';

/**
 * The distance between a shadow and its object, that is peter-panning.
 *
 * Measuring the elevation from `SCENE.SUN_OFFSET` (y = 80, which is noon) measures the wrong
 * thing: **the sun moves** — WeatherRenderer rewrites `sunOffset` every frame, and the showcase's
 * default time of 0.3 is only 19.7 degrees. Counting `normalBias` alone also misses the
 * depth-space `bias`, which is an order of magnitude larger. So the tests stay green and the
 * screen is unchanged.
 *
 * So this measures the **worst-case sun** and the **sum of both biases**.
 */

/** The light-to-focus distance, in cells. SUN_OFFSET's y is an absolute height and its xz a relative offset. */
const LIGHT_DISTANCE = Math.hypot(
  SCENE.SUN_OFFSET.x, SCENE.SUN_OFFSET.y, SCENE.SUN_OFFSET.z,
);

/** The shadow camera's half-width at the default zoom: a 60-cell frustum at 16:9, taking the long side plus 30% margin. */
const PADDED_DEFAULT = (60 * (16 / 9)) / 2 * 1.3;

function offsetAt(dayFraction: number, padded = PADDED_DEFAULT): number {
  const { near, far } = shadowDepthRange(LIGHT_DISTANCE, padded);
  return shadowOffsetMetres({
    normalBias: SCENE.SHADOW_NORMAL_BIAS,
    depthBias: SCENE.SHADOW_BIAS,
    near, far,
    sunElevationRad: sunElevationRad(dayFraction),
  });
}

describe('shadow offset', () => {
  it('should stay small at the showcase default time, not just at noon', () => {
    // The showcase's default timeOverride is 0.3, which is where this is visible. Measuring only
    // normalBias at noon gives 5 cm and passes, while the real offset here is 2.4 m.
    expect(offsetAt(0.3), '展示區預設時間下陰影還是離物體很遠')
      .toBeLessThan(0.25);
  });

  it('should survive the lowest sun of the day', () => {
    // The lower the sun the smaller the tan and the larger the offset. The worst case is where sunY
    // is clamped at 80 x 0.1, at dawn and dusk, rather than at noon — and the day-night cycle passes
    // through it every time.
    const worst = worstSunElevationRad();
    const { near, far } = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    const offset = shadowOffsetMetres({
      normalBias: SCENE.SHADOW_NORMAL_BIAS,
      depthBias: SCENE.SHADOW_BIAS,
      near, far, sunElevationRad: worst,
    });
    expect(offset, '低太陽時陰影整片脫離').toBeLessThan(1.0);
  });

  it('should not let the depth range inflate the depth bias', () => {
    // `shadow.bias` is a value in [0, 1] depth space, and a world distance takes it times
    // (far - near). A hard-coded 1 / 200 gives 199 cells = 2388 m of depth while the light is only
    // about 107 cells from the focus, and that width more than doubles the bias.
    const { near, far } = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    expect(far - near, '深度範圍比需要的寬').toBeLessThan(199);
    expect(near, 'near 不能落到 0 以下').toBeGreaterThan(0);
    // Casters have to fall entirely within the range, or their shadows are clipped.
    expect(near, 'near 切到最近的投影者')
      .toBeLessThanOrEqual(LIGHT_DISTANCE - PADDED_DEFAULT - MAX_CASTER_HEIGHT + 1e-9);
    expect(far, 'far 切到最遠的投影者')
      .toBeGreaterThanOrEqual(LIGHT_DISTANCE + PADDED_DEFAULT + MAX_CASTER_HEIGHT);
  });

  it('should tighten the depth range when zoomed in on a lamp post', () => {
    // Zoomed in on a lamp post the shadow camera shrinks and the depth range shrinks with it, which
    // a hard-coded near/far cannot benefit from.
    //
    // This measures the **depth range** rather than the total offset: with the depth term fixed,
    // `normalBias` dominates, and it is a fixed world distance and by definition does not change
    // with zoom. Asserting "zooming in shrinks it a lot" against the total offset measures the other
    // term's weight instead.
    const closePadded = (20 * (16 / 9)) / 2 * 1.3;
    const wide = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    const close = shadowDepthRange(LIGHT_DISTANCE, closePadded);
    expect(close.far - close.near, '拉近之後深度範圍沒有跟著收')
      .toBeLessThan((wide.far - wide.near) * 0.5);

    // And the total offset must at least not grow on zooming in.
    expect(offsetAt(0.3, closePadded)).toBeLessThanOrEqual(offsetAt(0.3));
  });

  it('should still push the sample off the surface at all', () => {
    // The failure in the other direction: zeroing both biases grows self-shadowing stripes, that is
    // acne, across the ground.
    expect(SCENE.SHADOW_NORMAL_BIAS, 'normalBias 被歸零了').toBeGreaterThan(0);
    expect(SCENE.SHADOW_BIAS, '深度 bias 應該是負的').toBeLessThan(0);
  });

  it('should express normalBias in this project units', () => {
    // One unit is 12 m, so anything that looks like a metre-scale default is an order of magnitude
    // too large.
    expect(SCENE.SHADOW_NORMAL_BIAS * METRES_PER_CELL, 'normalBias 換算成公尺後過大')
      .toBeLessThan(0.1);
  });
});

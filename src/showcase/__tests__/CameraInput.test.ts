import { describe, it, expect } from 'vitest';
import { dragToOrbit, dragToPan, wheelToZoom, ORBIT_SENSITIVITY } from '../cameraInput';

/**
 * Wiring the DOM up wrongly gives no response at all and is obvious. A wrong conversion only feels
 * off: orbiting too fast, panning that drags once zoomed out, a reversed wheel. So these cases test
 * the conversions.
 */
describe('dragToOrbit', () => {
  it('should turn a rightward drag into a positive angle', () => {
    expect(dragToOrbit(100, 0).angle).toBeGreaterThan(0);
  });

  it('should raise the view when dragging downward', () => {
    // The drag direction and the elevation are opposed: dragging down raises the camera, the
    // convention for isometric views.
    expect(dragToOrbit(0, 100).elevation).toBeLessThan(0);
    expect(dragToOrbit(0, -100).elevation).toBeGreaterThan(0);
  });

  it('should scale linearly with distance', () => {
    expect(dragToOrbit(200, 0).angle).toBeCloseTo(dragToOrbit(100, 0).angle * 2, 10);
  });

  it('should need a reasonable drag for a quarter turn', () => {
    // How many pixels a quarter turn takes. Too sensitive overshoots; too dull is tiring to drag.
    const pixels = (Math.PI / 2) / ORBIT_SENSITIVITY.ANGLE_PER_PIXEL;
    expect(pixels).toBeGreaterThan(120);
    expect(pixels).toBeLessThan(400);
  });

  it('should do nothing when the pointer does not move', () => {
    // toEqual and toBe both distinguish +0 from -0 through Object.is, and 0 * -0.005 is -0. The sign
    // of zero means nothing here, so the comparison is approximate.
    const o = dragToOrbit(0, 0);
    expect(o.angle).toBeCloseTo(0, 10);
    expect(o.elevation).toBeCloseTo(0, 10);
  });
});

describe('dragToPan', () => {
  it('should move the world opposite to the drag, so content follows the cursor', () => {
    expect(dragToPan(100, 0, 60, 600).x).toBeLessThan(0);
    expect(dragToPan(0, 100, 60, 600).z).toBeLessThan(0);
  });

  it('should move further per pixel when zoomed out', () => {
    // Without this proportion, panning while zoomed out is slow enough to feel stuck.
    const near = Math.abs(dragToPan(100, 0, 20, 600).x);
    const far = Math.abs(dragToPan(100, 0, 120, 600).x);
    expect(far).toBeGreaterThan(near * 5);
  });
});

describe('wheelToZoom', () => {
  it('should zoom out on a positive deltaY, as browsers report scroll-down', () => {
    expect(wheelToZoom(100)).toBeGreaterThan(0);
    expect(wheelToZoom(-100)).toBeLessThan(0);
  });

  it('should move a sensible amount per notch', () => {
    // The orthographic view is about 60 units by default and one wheel notch moves 3, so 5% per
    // notch and roughly 20 notches across the whole range.
    expect(Math.abs(wheelToZoom(100))).toBeGreaterThan(1);
    expect(Math.abs(wheelToZoom(100))).toBeLessThan(10);
  });
});

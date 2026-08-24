import { dragToPan } from '../renderer/cameraPan';

/**
 * The showcase's mouse handling.
 *
 * The game's camera input is bound into the whole interaction model in src/input/ — tools, selection,
 * dragging out roads — which the showcase neither needs nor should pull in. This does three things:
 * orbit, pan and zoom.
 *
 * The conversion arithmetic is extracted as pure functions, because it is the one part that can be
 * wrong without showing: wiring the DOM up wrongly gives no response at all, while a wrong
 * sensitivity only feels off.
 */

/** Pixels of mouse drag to radians of camera rotation. */
export const ORBIT_SENSITIVITY = {
  /** Horizontal rotation per pixel, in radians. 100 px is about 46 degrees. */
  ANGLE_PER_PIXEL: 0.008,
  /** Elevation change per pixel, in radians. Opposed in direction: dragging down raises the view. */
  ELEVATION_PER_PIXEL: -0.005,
} as const;

/** The change in orthographic view size for one wheel notch, a deltaY of about 100. */
export const ZOOM_PER_WHEEL_UNIT = 0.03;

/** Converts a drag into orbitCamera's two parameters. */
export function dragToOrbit(dx: number, dy: number): { angle: number; elevation: number } {
  return {
    angle: dx * ORBIT_SENSITIVITY.ANGLE_PER_PIXEL,
    elevation: dy * ORBIT_SENSITIVITY.ELEVATION_PER_PIXEL,
  };
}

// The pan conversion lives in renderer/cameraPan: the game's right-button drag is the same gesture,
// and the copy here hardcoded 600 as the denominator, assuming a canvas always 600 px tall. It is
// re-exported for the existing callers and tests.
export { dragToPan };

/** Converts a wheel deltaY into zoomCamera's parameter. */
export function wheelToZoom(deltaY: number): number {
  return deltaY * ZOOM_PER_WHEEL_UNIT;
}

/** The part of SceneManager this module uses. */
export interface CameraTarget {
  orbitCamera(deltaAngle: number, deltaElevation: number): void;
  panCamera(dx: number, dz: number): void;
  zoomCamera(delta: number): void;
  readonly camera: { top: number; bottom: number };
}

/**
 * Wires up the mouse: left drag orbits, right drag (or shift with the left button) pans, the wheel
 * zooms.
 */
export function attachCameraInput(dom: HTMLElement, scene: CameraTarget): void {
  let dragging: 'orbit' | 'pan' | null = null;
  let lastX = 0;
  let lastY = 0;

  dom.addEventListener('pointerdown', (e) => {
    dragging = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture(e.pointerId);
  });

  dom.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (dragging === 'orbit') {
      const o = dragToOrbit(dx, dy);
      scene.orbitCamera(o.angle, o.elevation);
    } else {
      const viewSize = scene.camera.top - scene.camera.bottom;
      const p = dragToPan(dx, dy, viewSize, dom.clientHeight);
      scene.panCamera(p.x, p.z);
    }
  });

  const stop = (e: PointerEvent) => {
    dragging = null;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  };
  dom.addEventListener('pointerup', stop);
  dom.addEventListener('pointercancel', stop);

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    scene.zoomCamera(wheelToZoom(e.deltaY));
  }, { passive: false });

  // The right button pans, so the browser menu stays closed.
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
}

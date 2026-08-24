/**
 * Converts a drag in pixels into a shift of the camera target. Shared by the game and the showcase.
 *
 * There is one criterion for correctness: **the point under the cursor stays under the cursor.** Drag
 * N pixels and the world moves by whatever distance N pixels represents at the current zoom, so the
 * ratio is `frustum height / canvas height`, cells per pixel, and not any fixed constant.
 *
 * A second copy in the showcase hardcoded 600 as the denominator, assuming a canvas always 600 px
 * tall, while the game's space + left button path used the real height: one gesture, two formulas,
 * agreeing only in a 600 px window.
 */

/**
 * @param dx           The horizontal drag, in pixels.
 * @param dy           The vertical drag, in pixels.
 * @param viewSize     The orthographic frustum's height in cells, `camera.top - camera.bottom`.
 * @param canvasHeight The canvas height, in pixels.
 */
export function dragToPan(
  dx: number, dy: number, viewSize: number, canvasHeight: number,
): { x: number; z: number } {
  // `clientHeight` is 0 before the canvas has been laid out. Dividing by zero turns the camera
  // target into NaN, and NaN in cameraTarget never comes back out: the view disappears entirely and
  // nothing reports it.
  const scale = canvasHeight > 0 ? viewSize / canvasHeight : 0;
  return { x: -dx * scale, z: -dy * scale };
}

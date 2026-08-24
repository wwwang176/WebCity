/**
 * Whether low props and overhangs draw when zoomed out.
 *
 * The camera is orthographic, so there is no such thing as a distant building: the whole screen is
 * at one distance and a per-building distance means nothing. The only effective signal is the
 * frustum height (`camera.top - camera.bottom`, in cells; `zoomCamera` ranges 3 to 200). The whole
 * thing is therefore one global boolean flipping two layers' `visible`: no per-instance cost, no
 * simplified geometry, and no per-frame sweep over the cells.
 *
 * A module of its own rather than part of `BuildingRenderer`: the showcase uses the same
 * thresholds, draws plain `Mesh` objects and deliberately does not load the game. Importing from
 * `BuildingRenderer` would drag `Grid` and the whole renderer into the showcase's dependency graph.
 * Nothing here imports Three.js; it is pure arithmetic.
 *
 * A second copy is the mistake behind the showcase's floor colour (BUG-231).
 */

export const DETAIL_LOD = {
  /**
   * At 12 m per cell, a 90-cell frustum is 1080 m. On a 1080p screen that is about one pixel per
   * metre, and low props are mostly 1 to 4 m things: past this line they are already noise, while
   * still spending their full triangle allowance — 320 per building against the massing's 400 and
   * 800 — and each casting a shadow.
   */
  HIDE_ABOVE: 90,
  /**
   * 15 cells of hysteresis between the two lines. With a single line, a wheel resting on it switches
   * the whole layer on and off every frame — worse than doing nothing, because the screen flickers.
   * The default frustum is 60, below this line, so normal play shows every detail and the drop takes
   * a deliberate zoom out.
   */
  SHOW_BELOW: 75,
} as const;

/**
 * Whether detail should be hidden at this frustum height. `wasHidden` is the previous frame's
 * answer, which the hysteresis needs, so this function deliberately gives two answers for one
 * input.
 */
export function detailHidden(frustumHeight: number, wasHidden: boolean): boolean {
  return wasHidden
    ? frustumHeight >= DETAIL_LOD.SHOW_BELOW
    : frustumHeight > DETAIL_LOD.HIDE_ABOVE;
}

/**
 * Matches a canvas' bitmap size to its real size on screen.
 *
 * `<canvas width>` is how many pixels the bitmap holds while the CSS `width` is how large that image
 * is stretched to; where the two disagree the browser scales the bitmap and every line and letter
 * blurs. A chart with 480x100 written into the attributes displayed at 613x100, and at a device pixel
 * ratio of 1.5 that is a 1.92-fold enlargement.
 *
 * It returns the width and height in **CSS pixels**. Callers draw in those coordinates and leave the
 * scaling to the transform: with each chart multiplying by the dpr itself, one of them always misses.
 */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  // Measures 0 while the panel is not laid out yet, or is collapsed. This frame is skipped and the
  // next data update comes back.
  if (rect.width === 0 || rect.height === 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const bitmapW = Math.round(rect.width * dpr);
  const bitmapH = Math.round(rect.height * dpr);
  // Written only on a real change: assigning width or height clears the canvas and resets the context
  // state, so doing it every frame is an extra clear every frame.
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW;
    canvas.height = bitmapH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

/**
 * A chart's readout.
 *
 * Written straight into the top-left corner, the lines run across the text: "Happy: 50%" sits under a
 * line, and it is the only place on the chart carrying a number.
 *
 * It is drawn instead on a dark plate, always last, so no line can cover it.
 *
 * Two states:
 *
 * - **Hovering**: the plate follows the cursor, showing that point's date and each series' value, with
 *   a vertical line marking which bucket is being read. It disappears when the pointer leaves: a
 *   readout left on screen corresponds to no cursor position and looks stuck.
 * - **Not hovering**: a small legend remains — colours and names, no numbers. Removed entirely the
 *   chart carries no text at all and there is no telling which line is which, which is what the three
 *   names in the corner were for.
 */

export interface TooltipLine {
  /** The swatch's colour, matching that series' colour on the chart; out of step, the swatch is decoration. */
  color: string;
  label: string;
  value: string;
}

const PAD = 6;
const ROW_H = 13;
const DOT = 5;
const FONT = '10px sans-serif';
/** The distance from the cursor to the plate. Drawn against the cursor, the plate covers the bucket being pointed at. */
const CURSOR_GAP = 12;

/**
 * @param at The cursor position in CSS pixels. `null` means the chart is not hovered, and only the
 *           legend is drawn, without numbers.
 */
export function drawChartTooltip(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  title: string,
  lines: readonly TooltipLine[],
  at: { x: number; y: number } | null,
): void {
  if (lines.length === 0) return;
  ctx.font = FONT;

  const hovering = at !== null;
  const text = (l: TooltipLine) => hovering ? `${l.label}  ${l.value}` : l.label;
  const rows = lines.length + (hovering ? 1 : 0);

  const textW = Math.max(
    hovering ? ctx.measureText(title).width : 0,
    ...lines.map(l => DOT + 4 + ctx.measureText(text(l)).width),
  );
  const boxW = textW + PAD * 2;
  const boxH = PAD * 2 + ROW_H * rows;

  let x = PAD / 2;
  let y = PAD / 2;
  if (at) {
    // Clamped inside the canvas: the plate flips left near the right edge and up near the bottom, or
    // half of it falls outside.
    x = at.x + CURSOR_GAP;
    if (x + boxW > w) x = at.x - CURSOR_GAP - boxW;
    y = at.y + CURSOR_GAP;
    if (y + boxH > h) y = at.y - CURSOR_GAP - boxH;
    x = Math.max(0, Math.min(w - boxW, x));
    y = Math.max(0, Math.min(h - boxH, y));
  }

  ctx.fillStyle = 'rgba(6, 10, 20, 0.88)';
  roundRect(ctx, x, y, boxW, boxH, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 160, 210, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (hovering) {
    ctx.fillStyle = '#8fa4bd';
    ctx.fillText(title, x + PAD, y + PAD + ROW_H / 2);
  }

  lines.forEach((line, i) => {
    const rowY = y + PAD + ROW_H * (i + (hovering ? 1 : 0)) + ROW_H / 2;
    ctx.fillStyle = line.color;
    ctx.fillRect(x + PAD, rowY - DOT / 2, DOT, DOT);
    ctx.fillStyle = hovering ? '#c8d6e8' : '#7d8ea3';
    ctx.fillText(text(line), x + PAD + DOT + 4, rowY);
  });
}

/** Which point the hovered position corresponds to. Returns null when nothing is hovered or the chart is empty. */
export function hoveredIndex(x: number | null, w: number, count: number): number | null {
  if (x === null || count === 0) return null;
  const i = Math.floor((x / w) * count);
  return Math.max(0, Math.min(count - 1, i));
}

/** Draws a vertical line at the hovered position, showing which bucket is being read. */
export function drawChartCursor(ctx: CanvasRenderingContext2D, x: number, h: number): void {
  ctx.strokeStyle = 'rgba(200, 220, 245, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, 0);
  ctx.lineTo(Math.round(x) + 0.5, h);
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { UI_COLORS } from '../constants';
import { bucketChartSeries, type ChartHistory, type ChartRange } from '../../core/economy/ChartSeries';
import { fitCanvas } from './fitCanvas';
import { drawChartTooltip, drawChartCursor, hoveredIndex } from './chartTooltip';


/**
 * The history of funds and cash flow.
 *
 * **The two quantities are drawn separately because they are two different things.** Funds are a
 * stock, how much money there is now, and a line states its direction. Income and expenses are a flow
 * per period, discrete figures one bucket at a time, and only bars make a single period readable.
 * With all three as lines in one frame, the flows are squeezed into the bottom third and overlap,
 * showing little beyond movement.
 *
 * The flows are drawn as bars symmetrical about the zero line: income up, expenses down, and the gap
 * between them is the net. The question this chart really answers is whether this period made or lost
 * money, and in this encoding that answer needs no arithmetic.
 */

/** Funds on the top half, flows on the bottom, with a gap separating the two. */
const LEGEND_H = 14;
const FUNDS_RATIO = 0.55;
const BAND_GAP = 6;

export function EconChart(props: { history: ChartHistory; range: ChartRange }) {
  let canvas: HTMLCanvasElement | undefined;
  const [hover, setHover] = createSignal<{ x: number; y: number } | null>(null);

  const draw = () => {
    if (!canvas) return;
    // The bitmap's size has to match its size on screen, or the browser scales the image up and the
    // text blurs.
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx, w, h } = fit;
    ctx.clearRect(0, 0, w, h);

    const series = bucketChartSeries(props.history, props.range);
    if (series.funds.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    const plotH = h - LEGEND_H;
    const fundsH = plotH * FUNDS_RATIO - BAND_GAP / 2;
    const fundsTop = LEGEND_H;
    const flowTop = fundsTop + fundsH + BAND_GAP;
    const flowH = h - flowTop;
    const zeroY = flowTop + flowH / 2;

    // ── Funds: one line ────────────────────────────────────────────
    const maxFunds = Math.max(1000, ...series.funds);
    const minFunds = Math.min(0, ...series.funds);
    const fundsRange = maxFunds - minFunds || 1;

    ctx.strokeStyle = UI_COLORS.ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const span = Math.max(1, series.funds.length - 1);
    for (let i = 0; i < series.funds.length; i++) {
      const x = (i / span) * w;
      const y = fundsTop + fundsH - ((series.funds[i]! - minFunds) / fundsRange) * fundsH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Flows: bars about the zero line ────────────────────────────
    const maxFlow = Math.max(1, ...series.income, ...series.expenses);
    const half = flowH / 2;
    const slot = w / series.income.length;
    // A gap between buckets, dropped where they are too narrow: a one-pixel gap makes the row look
    // like noise.
    const barW = Math.max(1, slot > 3 ? slot - 1.5 : slot);

    for (let i = 0; i < series.income.length; i++) {
      const x = i * slot + (slot - barW) / 2;
      const up = (series.income[i]! / maxFlow) * half;
      const down = (series.expenses[i]! / maxFlow) * half;
      ctx.fillStyle = UI_COLORS.STATUS_GOOD;
      ctx.fillRect(x, zeroY - up, barW, up);
      ctx.fillStyle = UI_COLORS.STATUS_BAD;
      ctx.fillRect(x, zeroY, barW, down);
    }

    // The zero line is drawn over the bars: covered by them, there is no baseline to read against.
    ctx.strokeStyle = 'rgba(180, 200, 230, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY + 0.5);
    ctx.lineTo(w, zeroY + 0.5);
    ctx.stroke();

    // The readout is drawn last, over the line and the bars. With the three names in the top-left
    // corner, the line runs across the text.
    const at = hover();
    const i = hoveredIndex(at?.x ?? null, w, series.funds.length) ?? series.funds.length - 1;
    if (at) drawChartCursor(ctx, i * slot + slot / 2, h);
    const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
    drawChartTooltip(ctx, w, h, `Day ${series.days[i] ?? 0}`, [
      { color: UI_COLORS.ACCENT, label: 'Funds', value: money(series.funds[i] ?? 0) },
      { color: UI_COLORS.STATUS_GOOD, label: 'Income', value: money(series.income[i] ?? 0) },
      { color: UI_COLORS.STATUS_BAD, label: 'Expenses', value: money(series.expenses[i] ?? 0) },
    ], at);
  };

  onMount(() => {
    draw();
    // A change of window size or device pixel ratio leaves the bitmap out of step, and a redraw is
    // triggered only by data, range and cursor — none of which move while the game is paused, leaving
    // the chart blurred.
    window.addEventListener('resize', draw);
    onCleanup(() => window.removeEventListener('resize', draw));
  });
  createEffect(() => {
    // Tracked: the history being replaced once a day, a change of range, and cursor movement all
    // redraw.
    props.history;
    props.range;
    hover();
    draw();
  });

  const onMove = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // The size comes from CSS and `fitCanvas` matches the bitmap to it.
  return (
    <canvas
      ref={canvas}
      class="modal-chart"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    />
  );
}

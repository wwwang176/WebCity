import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { UI_COLORS } from '../constants';
import { fitCanvas } from './fitCanvas';
import { drawChartTooltip, drawChartCursor, hoveredIndex } from './chartTooltip';
import { bucketChartSeries, type ChartHistory, type ChartRange } from '../../core/economy/ChartSeries';

const HAPPY_COLOR = '#ffd54f';

export function PopChart(props: { history: ChartHistory; range: ChartRange }) {
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
    if (series.pop.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    const maxPop = Math.max(10, ...series.pop);
    ctx.strokeStyle = UI_COLORS.STATUS_GOOD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const span = Math.max(1, series.pop.length - 1);
    for (let i = 0; i < series.pop.length; i++) {
      const x = (i / span) * w;
      const y = h - (series.pop[i]! / maxPop) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = HAPPY_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < series.happiness.length; i++) {
      const x = (i / span) * w;
      const y = h - (series.happiness[i]! / 100) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // The readout is drawn last, over the lines. Written in the top-left corner the text sits under a
    // line, and it is the only place on the chart carrying a number.
    const at = hover();
    const i = hoveredIndex(at?.x ?? null, w, series.pop.length) ?? series.pop.length - 1;
    if (at) drawChartCursor(ctx, (i / span) * w, h);
    drawChartTooltip(ctx, w, h, `Day ${series.days[i] ?? 0}`, [
      { color: UI_COLORS.STATUS_GOOD, label: 'Pop', value: `${Math.round(series.pop[i] ?? 0)}` },
      { color: HAPPY_COLOR, label: 'Happy', value: `${Math.round(series.happiness[i] ?? 0)}%` },
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

  // No width or height attributes: the size comes from CSS and `fitCanvas` matches the bitmap to it.
  // Written here they are a second source of truth free to disagree — the attribute said 80 where the
  // CSS said 100.
  return (
    <canvas
      ref={canvas}
      class="modal-chart"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    />
  );
}

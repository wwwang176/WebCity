import { createEffect, createSignal, onMount } from 'solid-js';
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
    // 點陣圖尺寸要對齊畫面上的實際大小，否則瀏覽器直接放大那張圖，文字就糊了。
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

    // 讀數畫在最後，蓋在線上面。原本寫在左上角的字會被線壓住 —— 而那是圖上唯一
    // 寫著數字的地方。
    const at = hover();
    const i = hoveredIndex(at?.x ?? null, w, series.pop.length) ?? series.pop.length - 1;
    if (at) drawChartCursor(ctx, (i / span) * w, h);
    drawChartTooltip(ctx, w, h, `Day ${series.days[i] ?? 0}`, [
      { color: UI_COLORS.STATUS_GOOD, label: 'Pop', value: `${Math.round(series.pop[i] ?? 0)}` },
      { color: HAPPY_COLOR, label: 'Happy', value: `${Math.round(series.happiness[i] ?? 0)}%` },
    ], at);
  };

  onMount(() => draw());
  createEffect(() => {
    // 追蹤:歷史整包換掉（每天一次）、範圍切換、游標移動都要重畫。
    props.history;
    props.range;
    hover();
    draw();
  });

  const onMove = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // 不給 width/height —— 尺寸由 CSS 決定，點陣圖由 `fitCanvas` 對齊。寫在這裡
  // 只會多一個對不上的真相來源（原本寫 80，而 CSS 是 100）。
  return (
    <canvas
      ref={canvas}
      class="modal-chart"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    />
  );
}

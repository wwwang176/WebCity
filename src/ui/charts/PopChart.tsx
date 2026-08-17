import { createEffect, onMount } from 'solid-js';
import { UI_COLORS } from '../constants';
import { fitCanvas } from './fitCanvas';
import { bucketChartSeries, type ChartHistory, type ChartRange } from '../../core/economy/ChartSeries';

export function PopChart(props: { history: ChartHistory; range: ChartRange }) {
  let canvas: HTMLCanvasElement | undefined;

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

    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < series.happiness.length; i++) {
      const x = (i / span) * w;
      const y = h - (series.happiness[i]! / 100) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = UI_COLORS.STATUS_GOOD;
    ctx.fillText(`Pop: ${Math.round(series.pop[series.pop.length - 1] ?? 0)}`, 4, 10);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(`Happy: ${Math.round(series.happiness[series.happiness.length - 1] ?? 0)}%`, 80, 10);
  };

  onMount(() => draw());
  createEffect(() => {
    // 追蹤:歷史整包換掉（每天一次）與範圍切換都要重畫。
    props.history;
    props.range;
    draw();
  });

  // 不給 width/height —— 尺寸由 CSS 決定，點陣圖由 `fitCanvas` 對齊。寫在這裡
  // 只會多一個對不上的真相來源（原本寫 80，而 CSS 是 100）。
  return <canvas ref={canvas} class="modal-chart" />;
}

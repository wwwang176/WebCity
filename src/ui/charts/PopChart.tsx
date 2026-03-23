import { createEffect, onMount } from 'solid-js';
import { CHART_HISTORY_LENGTH, UI_COLORS } from '../constants';

const CHART_MAX = CHART_HISTORY_LENGTH;

export function PopChart(props: { history: { pop: number[]; happiness: number[] } }) {
  let canvas: HTMLCanvasElement | undefined;

  const draw = () => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (props.history.pop.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    const maxPop = Math.max(10, ...props.history.pop);
    ctx.strokeStyle = UI_COLORS.STATUS_GOOD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < props.history.pop.length; i++) {
      const x = (i / (CHART_MAX - 1)) * w;
      const y = h - (props.history.pop[i]! / maxPop) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < props.history.happiness.length; i++) {
      const x = (i / (CHART_MAX - 1)) * w;
      const y = h - (props.history.happiness[i]! / 100) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = UI_COLORS.STATUS_GOOD;
    ctx.fillText(`Pop: ${props.history.pop[props.history.pop.length - 1] ?? 0}`, 4, 10);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(`Happy: ${props.history.happiness[props.history.happiness.length - 1] ?? 0}%`, 80, 10);
  };

  onMount(() => draw());
  createEffect(() => {
    // Access props to create dependency
    props.history.pop.length;
    props.history.happiness.length;
    draw();
  });

  return <canvas ref={canvas} class="modal-chart" width={480} height={80} />;
}

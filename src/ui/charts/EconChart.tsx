import { createEffect, onMount } from 'solid-js';

const ECON_MAX = 60;

export function EconChart(props: { history: { funds: number[]; income: number[]; expenses: number[] } }) {
  let canvas: HTMLCanvasElement | undefined;

  const draw = () => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (props.history.funds.length < 2) {
      ctx.fillStyle = '#667a90';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', w / 2 - 40, h / 2);
      return;
    }

    const maxFunds = Math.max(1000, ...props.history.funds);
    const minFunds = Math.min(0, ...props.history.funds);
    const range = maxFunds - minFunds || 1;

    ctx.strokeStyle = '#42a5f5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < props.history.funds.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - ((props.history.funds[i]! - minFunds) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const maxInc = Math.max(1, ...props.history.income, ...props.history.expenses);
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < props.history.income.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - (props.history.income[i]! / maxInc) * (h / 3) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < props.history.expenses.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = h - (props.history.expenses[i]! / maxInc) * (h / 3) - 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#42a5f5';
    ctx.fillText('Funds', 4, 10);
    ctx.fillStyle = '#66bb6a';
    ctx.fillText('Income', 50, 10);
    ctx.fillStyle = '#ef5350';
    ctx.fillText('Expenses', 100, 10);
  };

  onMount(() => draw());
  createEffect(() => {
    props.history.funds.length;
    props.history.income.length;
    draw();
  });

  return <canvas ref={canvas} class="modal-chart" width={480} height={100} />;
}

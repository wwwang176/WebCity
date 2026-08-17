import { createEffect, onMount } from 'solid-js';
import { CHART_HISTORY_LENGTH, UI_COLORS } from '../constants';

const ECON_MAX = CHART_HISTORY_LENGTH;

/**
 * 資金與收支的歷史。
 *
 * **兩種量分開畫，因為它們是兩種東西。** 資金是存量（現在有多少錢），一條線把它
 * 的走向講清楚;收支是每一期的流量（這一期進來多少、出去多少），那是一格一格的離散
 * 數字，用長條才讀得出「這一期」。三條線擠在同一個框裡的版本，收支被壓進下面三分之一
 * 又互相重疊，實際上只看得出「有在動」。
 *
 * 收支畫成以零線為中心的對稱長條:收入往上、支出往下，中間那道空隙就是淨額。玩家在
 * 這張圖上真正要回答的問題是「我這一期是賺還是賠」，而那個答案在這個編碼裡不用算。
 */

/** 上半:資金。下半:收支。中間留一條空隙分開兩者。 */
const LEGEND_H = 14;
const FUNDS_RATIO = 0.55;
const BAND_GAP = 6;

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

    const plotH = h - LEGEND_H;
    const fundsH = plotH * FUNDS_RATIO - BAND_GAP / 2;
    const fundsTop = LEGEND_H;
    const flowTop = fundsTop + fundsH + BAND_GAP;
    const flowH = h - flowTop;
    const zeroY = flowTop + flowH / 2;

    // ── 資金:一條線 ────────────────────────────────────────────────
    const maxFunds = Math.max(1000, ...props.history.funds);
    const minFunds = Math.min(0, ...props.history.funds);
    const fundsRange = maxFunds - minFunds || 1;

    ctx.strokeStyle = UI_COLORS.ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < props.history.funds.length; i++) {
      const x = (i / (ECON_MAX - 1)) * w;
      const y = fundsTop + fundsH - ((props.history.funds[i]! - minFunds) / fundsRange) * fundsH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── 收支:以零線為中心的長條 ────────────────────────────────────
    const maxFlow = Math.max(1, ...props.history.income, ...props.history.expenses);
    const half = flowH / 2;
    const slot = w / ECON_MAX;
    // 每格之間留一點縫。太窄就不留 —— 一像素的縫會讓整排看起來像雜訊。
    const barW = Math.max(1, slot > 3 ? slot - 1.5 : slot);

    for (let i = 0; i < props.history.income.length; i++) {
      const x = i * slot + (slot - barW) / 2;
      const up = (props.history.income[i]! / maxFlow) * half;
      const down = (props.history.expenses[i]! / maxFlow) * half;
      ctx.fillStyle = UI_COLORS.STATUS_GOOD;
      ctx.fillRect(x, zeroY - up, barW, up);
      ctx.fillStyle = UI_COLORS.STATUS_BAD;
      ctx.fillRect(x, zeroY, barW, down);
    }

    // 零線畫在長條上面 —— 被長條蓋住的話就沒有基準可以比了。
    ctx.strokeStyle = 'rgba(180, 200, 230, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY + 0.5);
    ctx.lineTo(w, zeroY + 0.5);
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = UI_COLORS.ACCENT;
    ctx.fillText('Funds', 4, 10);
    ctx.fillStyle = UI_COLORS.STATUS_GOOD;
    ctx.fillText('Income', 50, 10);
    ctx.fillStyle = UI_COLORS.STATUS_BAD;
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

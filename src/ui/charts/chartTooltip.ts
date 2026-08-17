/**
 * 圖表上的讀數。
 *
 * 原本是把數值直接寫在左上角，而線條就從字上面穿過去 —— 「Happy: 50%」的字被線壓住，
 * 那是圖上唯一寫著數字的地方。
 *
 * 改成畫在一塊深色底板上，永遠疊在最後 —— 線再怎麼走都蓋不到它。
 *
 * 兩種狀態:
 *
 * - **滑上去**:底板跟著游標走，顯示那個時間點的日期與各序列的值，配一條直線標出讀的
 *   是哪一格。滑鼠離開就收掉 —— 停在畫面上的讀數對應不到任何游標位置，看起來像卡住。
 * - **沒滑**:只留一小塊圖例（顏色與名稱，沒有數字）。整個收掉的話圖上一個字都沒有，
 *   玩家沒辦法知道哪條線是哪一條 —— 而那正是原本左上角那三個名字在做的事。
 */

export interface TooltipLine {
  /** 色點的顏色。跟那條序列在圖上的顏色一致 —— 對不起來的話色點只是裝飾。 */
  color: string;
  label: string;
  value: string;
}

const PAD = 6;
const ROW_H = 13;
const DOT = 5;
const FONT = '10px sans-serif';
/** 游標與底板的距離。貼著游標畫的話，底板會蓋住你正指著的那一格。 */
const CURSOR_GAP = 12;

/**
 * @param at 游標位置（CSS 像素）。`null` 表示沒有滑到圖上 —— 只畫圖例，不畫數字。
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
    // 夾在畫布裡。游標靠右時翻到左邊，靠下時翻到上面 —— 不然底板有一半在畫布外。
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

/** 滑到的位置對應到第幾個點。沒有滑到或圖是空的就回 null。 */
export function hoveredIndex(x: number | null, w: number, count: number): number | null {
  if (x === null || count === 0) return null;
  const i = Math.floor((x / w) * count);
  return Math.max(0, Math.min(count - 1, i));
}

/** 滑到的位置畫一條直線，讓玩家看得出讀的是哪一格。 */
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

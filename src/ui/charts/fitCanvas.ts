/**
 * 把 canvas 的點陣圖尺寸對齊它在畫面上真正的大小。
 *
 * `<canvas width>` 是點陣圖有多少像素，CSS 的 `width` 是那張圖被拉成多大 —— 兩者對不
 * 起來時瀏覽器就直接放大那張點陣圖，線條與文字全部糊掉。圖表原本寫死 480×100，實際
 * 顯示 613×100，再乘上裝置像素比 1.5，等於放大了 1.92 倍。
 *
 * 回傳的是 **CSS 像素**下的寬高。呼叫端照這個座標畫就好，縮放交給 transform ——
 * 每個圖表自己乘一次 dpr 的話，總有一個地方會漏掉。
 */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  // 面板還沒排版完（或收起來）時量到 0。這一幀不畫，下一次資料更新會再來。
  if (rect.width === 0 || rect.height === 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const bitmapW = Math.round(rect.width * dpr);
  const bitmapH = Math.round(rect.height * dpr);
  // 只在真的變了才寫。指定 width/height 會清空畫布並重設 context 狀態，每幀做一次
  // 等於每幀多清一次。
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW;
    canvas.height = bitmapH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

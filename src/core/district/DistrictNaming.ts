/**
 * 分區的名字。
 *
 * 預設名字原本是 `District ${分區數量 + 1}`，而數量會因為合併而變少 —— 合併過一次
 * 之後再開新的就可能跟既有的撞名。兩個同名的分區在側邊欄裡分不出來，而條例是設定
 * 在各自身上的。
 */

/** 側邊欄只有 156px 寬。超過這個長度的名字在那裡只會變成一串省略號。 */
export const DISTRICT_NAME_MAX = 24;

const DEFAULT_NAME = /^District (\d+)$/;

/**
 * 下一個沒被用掉的預設名字。
 *
 * 補洞而不是往後跳 —— 合併掉 District 2 之後再開一個，玩家期待的是那個號碼回來，
 * 而不是憑空跳到 4。玩家自己改成 `District 5` 也算佔用:撞名的來源不分是誰取的。
 */
export function nextDistrictName(existing: readonly string[]): string {
  const taken = new Set<number>();
  for (const name of existing) {
    const m = DEFAULT_NAME.exec(name.trim());
    if (m) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `District ${n}`;
}

/**
 * 玩家輸入的名字。
 *
 * 空白會退回原本的名字 —— 空名字在側邊欄裡是一顆按不出東西的空按鈕。換行換成空格，
 * 貼上多行文字時才不會把按鈕撐開。
 */
export function sanitiseDistrictName(raw: string, fallback: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  return flat.slice(0, DISTRICT_NAME_MAX);
}

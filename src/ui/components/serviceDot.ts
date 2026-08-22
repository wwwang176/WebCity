import { serviceSeverity } from '../../core/service/ServiceSeverity';
import type { ServiceCellStatus } from '../../core/service/ServiceStatusView';

/**
 * 建築面板上那一排服務圓點。
 *
 * ## 為什麼是一個獨立的檔案
 *
 * 這段本來寫在 `BuildingPanel.tsx` 裡。單元測試跑在 node 環境（沒有 DOM），
 * TSX 裡的東西一行都測不到 —— 於是「圓點改回只看距離」這種改動可以整套測試全綠地
 * 溜過去。抽出來是為了讓那個改動會被抓到。
 *
 * ## 顏色說的是「有多糟」，提示說的是「為什麼」
 *
 * 一個圓點只有一個維度，而玩家要處理的有兩種:**太遠**要蓋一座近的，**太滿**要蓋
 * 一座分流。所以顏色取兩者比較糟的那一個，滑過去的提示把兩個數字都攤開。
 */

/** 沒有覆蓋。灰色 —— 跟「覆蓋得很差」的紅色是兩件事。 */
const NO_COVERAGE_COLOR = '#616161';

/**
 * 嚴重度 → 顏色。`-1` 灰、`0` 綠、`0.5` 黃、`1` 紅。
 *
 * 綠→黃→紅兩段線性，中間那一點是黃的。跟圖層的 10 階色帶是同一個走向，
 * 只是這裡是連續的。
 */
export function severityColor(severity: number): string {
  if (severity < 0) return NO_COVERAGE_COLOR;
  const r = Math.min(1, severity);
  if (r <= 0.5) {
    const red = Math.round(255 * (r * 2));
    return `rgb(${red},200,50)`;
  }
  const green = Math.round(200 * (1 - (r - 0.5) * 2));
  return `rgb(255,${green},50)`;
}

/** 一個服務圓點的顏色。距離與負載取比較糟的那一個。 */
export function serviceDotColor(st: ServiceCellStatus): string {
  return severityColor(serviceSeverity(st.cost, st.load));
}

/**
 * 滑過去的提示。
 *
 * 顏色只說「有多糟」——說不出是因為太遠還是因為太滿，而那決定玩家要蓋在哪裡。
 * 沒有負載概念的服務（水電）只印距離,不要憑空生一個 0%。
 */
export function serviceDotHint(label: string, st: ServiceCellStatus): string {
  if (st.cost < 0) return `${label}: no coverage`;
  const parts = [`distance ${Math.round(Math.min(1, st.cost) * 100)}%`];
  if (st.load >= 0) parts.push(`facility load ${Math.round(st.load * 100)}%`);
  return `${label}: ${parts.join(' · ')}`;
}

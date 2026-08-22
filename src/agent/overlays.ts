/**
 * 圖層資料 —— 玩家在畫面上看到的那兩層，變成程式讀得懂的形狀。
 *
 * ## 打開一張圖層，其實有兩層東西
 *
 * 以 Police 為例:
 *
 * | | 是什麼 | 值 |
 * |---|---|---|
 * | **地面色塊** | 這一格有沒有警力 | 80 或 0，**二元** |
 * | **建築高亮** | 沿著馬路走過來的成本 ÷ 預算 | 綠→黃→紅 **10 階** |
 *
 * 玩家真正在讀的是**第二層** —— 它說的不是「有沒有」，是「這棟房子的警力有多勉強」。
 * 只給第一層的話，agent 會拿到一堆沒有資訊量的 80。
 *
 * ## 不從渲染結果反推
 *
 * `Game.overlayHighlightCells` 存的是算完的 `{x, y, color}`，而且**只有那張圖層開著
 * 的時候才會被算出來**。從那裡讀的話，agent 想問「警力覆蓋怎麼樣」得先叫玩家把圖層
 * 打開 —— 而且 `cost` / `ratio` 都在挑完顏色之後就丟了。
 *
 * 所以這裡從**源頭**拿:`service.getCoveredCellsWithCost()` 加上那個服務自己的預算。
 * 顏色是它的衍生物（`tier = floor(ratio × 10)`），不是反過來。
 */

/** 走馬路成本、有 10 階漸層的那幾個服務。 */
export const COVERAGE_SERVICES = ['police', 'fire', 'health', 'education', 'garbage'] as const;

export type CoverageService = typeof COVERAGE_SERVICES[number];

export interface CoverageSource {
  /** 這個服務的成本預算。五個各不相同 —— 用錯一個，整張圖的階數都會偏。 */
  budget: number;
  /** `"x,y"` → 從最近的設施沿馬路走過來的成本。 */
  costs: ReadonlyMap<string, number>;
  /** 造成這些顏色的設施本身。畫面上是藍色的那些。 */
  sources: readonly { x: number; y: number }[];
  /** 10 階色帶，由 `Game` 給 —— 顏色不能兩邊各算一次。 */
  gradient: readonly number[];
}

export interface CoverageCell {
  x: number;
  y: number;
  /** 沿馬路走過來的成本。 */
  cost: number;
  /** `cost / budget`，夾在 1。越接近 1 代表這裡的服務越勉強。 */
  ratio: number;
  /** 0–9，跟畫面上的色階同一個。 */
  tier: number;
  color: string;
}

export interface CoverageInfo {
  service: string;
  budget: number;
  /** 有幾格被涵蓋。 */
  covered: number;
  cells: CoverageCell[];
  sources: readonly { x: number; y: number }[];
}

/** 這一層的數字該怎麼讀。 */
export type OverlayKind = 'binary' | 'continuous' | 'categorical' | 'unknown';

/**
 * 每一張地面圖層的數字是什麼意思。
 *
 * 不講的話呼叫端只能猜:拿到一整片 80 會以為自己漏抓了什麼，拿到分區的 37
 * 會以為那是強度而去跟 62 比大小。
 */
const OVERLAY_KINDS: Record<string, OverlayKind> = {
  // 有沒有覆蓋，沒有中間值。
  police: 'binary', fire: 'binary', health: 'binary',
  education: 'binary', park: 'binary', garbage: 'binary',
  // 真的是漸層，數字可以比大小。
  traffic: 'continuous', pollution: 'continuous', landValue: 'continuous',
  crime: 'continuous', commute: 'continuous',
  // 數字是**標籤**不是數量:分區的值是身分，power/water 是三階的狀態。
  power: 'categorical', water: 'categorical',
  zone: 'categorical', district: 'categorical',
};

export function overlayKind(type: string): OverlayKind {
  return OVERLAY_KINDS[type] ?? 'unknown';
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** `"12,8"` → `[12, 8]`。 */
function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/**
 * 建築那一層 —— 服務有多勉強。
 *
 * `tier` 用的是跟 `Game` 挑顏色一模一樣的式子。差一階的話，agent 說「那一區是黃的」
 * 就跟玩家螢幕上看到的對不起來 —— 而那種錯最難發現，因為兩邊都「看起來很合理」。
 */
export function buildCoverage(service: string, src: CoverageSource): CoverageInfo {
  const cells: CoverageCell[] = [];
  const top = src.gradient.length - 1;

  for (const [key, cost] of src.costs) {
    const [x, y] = parseKey(key);
    const ratio = Math.min(1, cost / src.budget);
    const tier = Math.min(top, Math.floor(ratio * 10));
    cells.push({ x, y, cost, ratio, tier, color: hex(src.gradient[tier]!) });
  }

  return {
    service,
    budget: src.budget,
    covered: cells.length,
    cells,
    sources: src.sources,
  };
}

export interface OverlayCellInfo {
  x: number;
  y: number;
  value: number;
  color: string;
}

/**
 * 地面那一層。
 *
 * `colorOf` 是 `OverlayRenderer.colorFor` —— **問它**而不是自己換算。那支函式的
 * 註解就寫著「顏色不能兩邊各算一次:改了一邊另一邊就不一樣」。
 */
export function buildOverlayCells(
  data: ReadonlyMap<string, number> | undefined,
  colorOf: (value: number) => number,
): OverlayCellInfo[] {
  if (!data) return [];
  const out: OverlayCellInfo[] = [];
  for (const [key, value] of data) {
    const [x, y] = parseKey(key);
    out.push({ x, y, value, color: hex(colorOf(value)) });
  }
  return out;
}

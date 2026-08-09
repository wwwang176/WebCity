import { TerrainType } from '../core/grid/types';

/**
 * 地形的顏色。
 *
 * 自成一個模組而不是留在 `TerrainRenderer` 裡：展示區的地板必須與遊戲的地形
 * 同色，否則**地面貼片的對比在兩邊完全不同** —— 工業區的柏油是 shade 0
 * （近黑），壓在亮綠地形上一眼就看得見，壓在展示區原本那塊暗綠地板上幾乎
 * 融進背景。而「展示區看到的就是出貨的東西」是它唯一的價值。
 *
 * 展示區直接匯入這張表而不是自己抄一份，所以兩者不可能漂移。從
 * `TerrainRenderer` 匯入會把 Grid 與 ViewMode 一起拖進展示區的相依圖 ——
 * 展示區刻意不載入遊戲，它要能在遊戲壞掉的時候仍然打得開。
 */
export const TERRAIN_COLORS: Record<number, number> = {
  [TerrainType.PLAIN]: 0x4caf50,
  [TerrainType.WATER]: 0x2196f3,
  [TerrainType.MOUNTAIN]: 0x4caf50,
  [TerrainType.FOREST]: 0x4caf50,
};

export const STONE_COLOR = 0x9e9e9e;

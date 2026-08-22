import type { GameState } from '../simulation/GameState';

/**
 * 服務**這一格**的那幾座設施現在各自多滿。
 *
 * ## 逐格，不是全城平均
 *
 * 建築面板的那幾條警告（`Hospital over capacity`、`Schools overcrowded`⋯）原本吃的是
 * `service.getLoadRatio()` —— 全城總需求 ÷ 全城總容量。於是城市另一頭的醫院爆量，
 * 這一棟也跳警告;而隔壁那間爆量、全城平均還好時，反而不跳。玩家看到的是
 * 「旁邊的國小明明很空，面板卻說教育爆量」（BUG-362 的後半）。
 *
 * 面板講的是**這一棟**。全城那一份仍然在，Overview 的 Services 頁在用。
 *
 * ## 為什麼是一個獨立的檔案
 *
 * 這段本來寫在 `Game.ts` 裡，而 `Game.ts` 直接 import Three.js —— 單元測試載不動它，
 * 於是「警告改回全城平均」這種退化可以整套測試全綠地溜過去。抽出來才測得到。
 */

/** 五個服務各自的逐格負載比值。`-1` = 這一格沒有覆蓋。 */
export interface ServiceLoadRatios {
  garbageLoadRatio: number;
  hospitalLoadRatio: number;
  educationLoadRatio: number;
  policeLoadRatio: number;
  fireLoadRatio: number;
}

/**
 * 服務這一格的那座掩埋場多滿。
 *
 * 比其他四個多一項:**還沒被收走的垃圾**。它不在任何一座掩埋場裡（所以不算進
 * `currentLoad`），但它正是玩家看到的問題本身 —— 掩埋場半滿而街上堆滿垃圾時，
 * 只看 `currentLoad` 會說一切正常。
 *
 * 待收量是全城的，攤在服務這一格的那一座頭上:「收不走」是那一座的責任。
 */
export function garbageLoadRatioAt(state: GameState, x: number, y: number): number {
  const id = state.garbage.getServingFacilityId(x, y);
  if (id === null) return -1;
  const fac = state.garbage.getFacilities().find(f => f.id === id);
  if (!fac) return -1;
  const load = fac.currentLoad + state.garbage.getUncollected();
  if (fac.capacity <= 0) return load > 0 ? Infinity : 0;
  return load / fac.capacity;
}

export function serviceLoadRatiosAt(state: GameState, x: number, y: number): ServiceLoadRatios {
  return {
    garbageLoadRatio: garbageLoadRatioAt(state, x, y),
    hospitalLoadRatio: state.health.getLoadRatioAt(x, y),
    educationLoadRatio: state.education.getLoadRatioAt(x, y),
    policeLoadRatio: state.police.getLoadRatioAt(x, y),
    fireLoadRatio: state.fire.getLoadRatioAt(x, y),
  };
}

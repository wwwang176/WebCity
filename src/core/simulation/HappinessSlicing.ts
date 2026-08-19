import { SIMULATION } from './SimulationConstants';

/**
 * 快樂度重算要分成幾片。
 *
 * `updateCitizenHappiness` 原本在慢速槽 4 裡把**每一位**市民重算一次，也就是每 6 個
 * tick 一次、每次 O(人口)。同一份存檔複製成 70 891 人實測:那一發 **68.5ms**，而速度 1
 * 的一個 tick 只有 250ms —— 玩家感覺到的是每 1.5 秒卡一下（BUG-330）。
 *
 * 改成每個 tick 只重算其中一片，`N` 個 tick 輪完一圈。每位市民身上都存著自己的快樂度，
 * 沒被輪到的人沿用上次的值 —— 全城平均照樣是「所有人身上的值加總 ÷ 人數」，不受哪一片
 * 剛被重算影響。這是**輪流**不是抽樣:沒有人被跳過，只是輪得比較慢。
 *
 * ### 為什麼 N 跟著人口長
 *
 * 固定 N（例如永遠 6 片）只是把尖峰攤平，總工作量不變 —— 30 萬人時每個 tick 還是要
 * 12.5ms。讓 N 跟著人口長，每個 tick 的工作量就變成常數。
 *
 * 代價是資料變舊。而舊得起:實測每位市民的快樂度趨勢是 **0.38 / 100 秒**，而既有的
 * 隨機抖動就有 **2.36** 的標準差 —— 放到一整個遊戲日，真正的漂移還在雜訊底下。
 *
 * ### 上限存在的理由不是新鮮度，是「不要壞得太離譜」
 *
 * 沒有上限的話 100 萬人要 476 個 tick（20 個遊戲日）才輪完一圈。上限鎖在 3 個遊戲日，
 * 超過 15 萬人之後成本才重新開始成長 —— 而那個成長很慢（100 萬人 13.9ms/tick），
 * 遠好過「固定落後一天」那種寫法（同樣人口 41.7ms/tick，速度 10 時直接吃光預算）。
 */

/** 每個 tick 重算幾位市民。決定成本 —— 這個數字乘上約 1µs 就是每 tick 的花費。 */
export const HAPPINESS_PER_TICK = 2100;

/**
 * 輪一圈最多幾個 tick。
 *
 * 3 個遊戲日（`ticksPerDay` 是 24）。要到 15 萬人以上才碰得到 —— 在那之下這個上限
 * 等於不存在。
 */
export const HAPPINESS_MAX_SLICES = 72;

/**
 * 這座城市要分成幾片。
 *
 * 下限是 `SLOW_TICK_INTERVAL`:那是 `updateCitizenHappiness` 原本的節奏。小城市算出來
 * 比它小的話一律取它 —— **行為與改動前完全相同**，每位市民仍然每 6 個 tick 更新一次。
 */
export function happinessSliceCount(population: number): number {
  const min = SIMULATION.SLOW_TICK_INTERVAL;
  if (!(population > 0)) return min;
  const wanted = Math.ceil(population / HAPPINESS_PER_TICK);
  return Math.min(HAPPINESS_MAX_SLICES, Math.max(min, wanted));
}

/**
 * 這位市民屬於哪一片。
 *
 * 用 id 的雜湊，不是用他在名單裡的位置:名單順序跟建城順序有關，而同時建成的市民
 * 往往住在同一區。照位置切的話每一片會是一個街區，出事時的反應會一區一區掃過去，
 * 而不是全城均勻地開始變化。雜湊之後每一片都是全城的橫切面。
 */
export function happinessSliceOf(citizenId: number, slices: number): number {
  // Knuth 乘法雜湊。`>>> 0` 把 imul 的有號結果轉回無號，否則負數取模會是負的。
  return ((Math.imul(citizenId, 2654435761) >>> 0) % slices);
}

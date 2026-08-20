import { SIMULATION } from './SimulationConstants';

/**
 * 逐市民的重算要分成幾片。快樂度與健康共用同一套。
 *
 * 兩者原本都在慢速槽 4 裡把**每一位**市民重算一次，也就是每 6 個 tick 一次、每次
 * O(人口)。同一份存檔複製成 70 891 人實測:快樂度那一發 **68.5ms**、健康 11.5ms，
 * 而速度 1 的一個 tick 只有 250ms —— 玩家感覺到的是每 1.5 秒卡一下（BUG-330）。
 *
 * 改成每個 tick 只重算其中一片，`N` 個 tick 輪完一圈。每位市民身上都存著自己的快樂度
 * 與健康，沒被輪到的人沿用上次的值 —— 全城平均照樣是「所有人身上的值加總 ÷ 人數」，
 * 不受哪一片剛被重算影響。這是**輪流**不是抽樣:沒有人被跳過，只是輪得比較慢。
 *
 * 快樂度與健康共用同一個雜湊，所以同一位市民的兩件事在同一個 tick 更新 —— 那一個
 * tick 裡他的住址查詢（`homeFactsFor`）算一次就好。
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
export const CITIZEN_SLICE_PER_TICK = 2100;

/**
 * 輪一圈最多幾個 tick。
 *
 * 3 個遊戲日（`ticksPerDay` 是 24）。要到 15 萬人以上才碰得到 —— 在那之下這個上限
 * 等於不存在。
 */
export const CITIZEN_SLICE_MAX = 72;

/**
 * 這座城市要分成幾片。
 *
 * 下限是 `SLOW_TICK_INTERVAL`:那是這兩件事原本的節奏。小城市算出來比它小的話一律
 * 取它 —— **行為與改動前完全相同**，每位市民仍然每 6 個 tick 更新一次。
 */
export function citizenSliceCount(population: number): number {
  const min = SIMULATION.SLOW_TICK_INTERVAL;
  if (!(population > 0)) return min;
  const wanted = Math.ceil(population / CITIZEN_SLICE_PER_TICK);
  return Math.min(CITIZEN_SLICE_MAX, Math.max(min, wanted));
}

/**
 * 這位市民屬於哪一片。
 *
 * 用 id 的雜湊，不是用他在名單裡的位置:名單順序跟建城順序有關，而同時建成的市民
 * 往往住在同一區。照位置切的話每一片會是一個街區，出事時的反應會一區一區掃過去，
 * 而不是全城均勻地開始變化。雜湊之後每一片都是全城的橫切面。
 *
 * ### 一個已知的相關性
 *
 * 乘數是奇數，所以 `imul(id, M) mod 2 === id mod 2` —— **片號的奇偶等於 id 的奇偶**。
 * 片數是偶數時（下限 6 就是），跟 id 奇偶相關的屬性會整批落在同一半的片裡。實際的
 * 城市裡 id 只是流水號，跟住哪、幾歲都無關，所以看不出影響;但寫測試時如果照 `i % 2`
 * 分配住址，兩組人會永遠不在同一個 tick 被處理。
 */
export function citizenSliceOf(citizenId: number, slices: number): number {
  // Knuth 乘法雜湊。`>>> 0` 把 imul 的有號結果轉回無號，否則負數取模會是負的。
  return ((Math.imul(citizenId, 2654435761) >>> 0) % slices);
}


/**
 * 一輪的游標。
 *
 * 片數在**開輪時**定死。每個 tick 從當下人口重算的話，人口跨過
 * `CITIZEN_SLICE_PER_TICK` 的倍數時 `citizenSliceOf` 會把所有人重新分片 —— 已經輪過
 * 的人可能又被排到後面，還沒輪到的人可能被排到已經走過的片。人口在門檻附近來回時
 * 沒有任何落後上界，可以構造出某人連續數百個 tick 不被更新。
 *
 * 有了游標，「一輪之內每個人剛好一次」才是真的不變量（對整輪都在城裡的人而言）。
 */
export class SliceCycle {
  private slices = 0;
  private cursor = 0;

  /**
   * 開始下一片。回傳這一個 tick 要處理哪一片、以及這一輪一共分成幾片。
   *
   * `countFor` 只在一輪跑完之後才被呼叫 —— 中途換片數就是上面說的那個 bug。
   */
  next(countFor: () => number): { slices: number; index: number } {
    if (this.cursor >= this.slices) {
      // 0 會讓 `citizenSliceOf` 取模得到 NaN（所有人被跳過，而且一輪永遠不結束）；
      // 負數會讓每次呼叫都重新開輪，部分人反覆落在第 0 片、其餘人永遠輪不到。
      this.slices = Math.max(1, Math.floor(countFor()) || 1);
      this.cursor = 0;
    }
    return { slices: this.slices, index: this.cursor++ };
  }

  /** 丟掉這一輪。城市清空時用 —— 下次會照新的人口重新開輪。 */
  reset(): void {
    this.slices = 0;
    this.cursor = 0;
  }
}

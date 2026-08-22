/**
 * StationLoadDistributor — 把全城的需求攤到各設施頭上。
 *
 * ## 誰服務這一格，只有一個答案
 *
 * 這裡原本用**歐氏直線**挑最近的設施。而覆蓋（圓點、圖層、`getCostRatio`）用的是
 * **沿馬路走過來的成本**。兩套規則會給出不同的答案:河對岸一間直線很近、開車要繞
 * 一大圈的設施會吸走這一區的需求，但它的道路覆蓋根本到不了這裡。於是那間顯示爆量
 * 卻服務不到任何人，而真正在服務這一區的那間顯示很空（BUG-363）。
 *
 * 現在改成問覆蓋:`ownerOf(x, y)` 回的就是覆蓋洪水判定「用最低成本涵蓋這一格」的
 * 那一座設施。同一個問題只有一個答案。
 *
 * 保留的仍是零配置:呼叫端的 Map 被清空後重填。
 */

export interface LoadDemand {
  x: number;
  y: number;
  weight: number;
}

export interface LoadableFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
}

export interface LoadDistributionResult {
  /** Total demand / total capacity. Infinity when capacity=0 but demand>0. */
  loadRatio: number;
  /**
   * 沒有落到任何設施頭上的需求量。
   *
   * 需求點在上一次覆蓋重算之後才失去覆蓋（設施被拆、斷電）時會發生。這些需求仍然
   * 算進 `loadRatio` 的分子 —— 它是真的存在的需求，只是沒有人在服務。歸零的話
   * 城市會在崩潰的當下顯示得更健康。
   */
  unassigned: number;
}

/**
 * 把每一筆需求攤到**服務那一格的那座設施**頭上。
 *
 * @param facilities 這一輪算得上數的設施（呼叫端自己過濾運作中／接得到路的）
 * @param demands 加權需求點
 * @param loadMap 重複使用的 Map<facilityId, 累計權重> —— 會被清空後重填
 * @param ownerOf 那一格由哪座設施服務。回 `null` 或回一個不在 `facilities` 裡的
 *   id，這筆需求就算在 `unassigned`。
 */
export function distributeLoadToServingFacility(
  facilities: readonly LoadableFacility[],
  demands: readonly LoadDemand[],
  loadMap: Map<string, number>,
  ownerOf: (x: number, y: number) => string | null,
): LoadDistributionResult {
  loadMap.clear();

  if (facilities.length === 0) {
    // 需求還是要算 —— 一座設施都沒有時 loadRatio 應該是 Infinity，不是 0。
    let total = 0;
    for (let i = 0; i < demands.length; i++) total += demands[i]!.weight;
    return { loadRatio: total > 0 ? Infinity : 0, unassigned: total };
  }

  const known = new Set<string>();
  for (let i = 0; i < facilities.length; i++) {
    loadMap.set(facilities[i]!.id, 0);
    known.add(facilities[i]!.id);
  }

  let total = 0;
  let unassigned = 0;
  for (let di = 0; di < demands.length; di++) {
    const d = demands[di]!;
    total += d.weight;
    const id = ownerOf(d.x, d.y);
    // 覆蓋算過之後才被拆掉／斷電的設施:索引還在，但它不該再收需求。
    if (id !== null && known.has(id)) {
      loadMap.set(id, loadMap.get(id)! + d.weight);
    } else {
      unassigned += d.weight;
    }
  }

  let cap = 0;
  for (let i = 0; i < facilities.length; i++) cap += facilities[i]!.capacity;
  const loadRatio = cap > 0 ? total / cap : (total > 0 ? Infinity : 0);
  return { loadRatio, unassigned };
}

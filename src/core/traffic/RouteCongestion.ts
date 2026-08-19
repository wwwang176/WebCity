/**
 * 路上塞不塞,從**需求**算出來。
 *
 * 輸入是 `computeCongestionFlow` 產生的逐格流量圖:每一格上有多少人的通勤路線經過,
 * 除以那一格的車道數。它跟畫面上生成了幾台車無關 —— 車輛實體有數量上限、會被生成點
 * 檢查擋掉,那是演繹,不是模擬。
 *
 * 這裡把流量換成 0（暢通）到 1（塞死）的擁擠程度,並提供兩種問法:
 * - `routeCongestion`：**這一趟**沿途有多擠。有路線可問的地方都該用這個。
 * - `cityCongestion`：整個路網的平均負載。給問不到路線的地方當退路。
 */

/**
 * 一格車道上有多少人的通勤路線經過,就算塞滿。
 *
 * **這是遊戲平衡的旋鈕,不是物理常數。** 跟 `CONGESTION_EXPONENT` 一起校準:讓
 * 12 280 人的參考城市（60×60 地圖、284 格道路）逐人的通勤擁擠度中位數落在 0.55
 * 左右 —— 明顯有負擔但還不到癱瘓,而且上面還有空間可以再惡化。
 *
 * 它是**絕對值**而不是跟人口綁定的比例,這是刻意的:同樣一條路,住的人愈多就該愈塞。
 * 綁人口的話城市長大不會變塞,那條回饋線等於沒接。
 */
export const FLOW_PER_LANE_SATURATED = 9000;

/**
 * 擁擠度隨流量上升的陡度。
 *
 * 空的路上多一台車沒感覺;快滿的路上多一台車,整條隊伍卡住。線性（指數 1）把這兩件事
 * 當成一樣重,結果是玩家花錢打通一個快爆的路口,回饋跟拓寬一條本來就順的路差不多。
 *
 * 參考城市上實測「把最塞的一成格子車道加倍」:
 *
 * | | 線性 | 四次方 |
 * |---|---|---|
 * | 通勤擁擠度中位數 | 0.553 → 0.405 | 0.553 → **0.233** |
 * | 開車時間 | ×1.55 → ×1.41（快 9%） | ×1.55 → **×1.23（快 21%）** |
 *
 * 兩者的起點校準成一樣,所以差的是**反應**不是水位。四次方也是交通工程裡描述
 * 路段行駛時間隨流量上升的常見形狀。
 */
export const CONGESTION_EXPONENT = 4;

/** 一格有多擠。0 = 空的,1 = 塞死。 */
export function cellCongestion(flowPerLane: number): number {
  if (!(flowPerLane > 0)) return 0;
  const load = flowPerLane / FLOW_PER_LANE_SATURATED;
  return load >= 1 ? 1 : Math.pow(load, CONGESTION_EXPONENT);
}

/**
 * 這一趟沿途有多擠 —— 經過的每一格的平均。
 *
 * 用平均而不是最塞的那一格:一趟通勤只卡在一個路口,跟整條路都在爬,不是同一件事,
 * 而開車時間是沿路累積的。取最大值會讓所有經過市中心的人都變成一樣糟。
 *
 * 路線上沒有任何格子時回傳 `null` —— 呼叫端自己決定要退回什麼,這裡不假裝知道。
 */
export function routeCongestion(
  cells: Iterable<string>,
  flowOf: (cellKey: string) => number,
): number | null {
  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    sum += cellCongestion(flowOf(cell));
    count++;
  }
  return count === 0 ? null : sum / count;
}

/**
 * 整個路網的平均負載。
 *
 * 分母是**全城道路格數**,不是「現在有車經過的格數」—— 空路也要算進去,那才是
 * 「蓋了路有沒有用」得以反映出來的地方。舊的算法只看有車的格子,結果城市愈大
 * 分母愈跟著漲,數字永遠貼在上限。
 */
export function cityCongestion(
  flowMap: ReadonlyMap<string, number>,
  roadCellCount: number,
): number {
  if (roadCellCount <= 0) return 0;
  let sum = 0;
  for (const flow of flowMap.values()) sum += cellCongestion(flow);
  return Math.min(1, sum / roadCellCount);
}

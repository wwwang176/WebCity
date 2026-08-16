import { TransportType } from './types';

/**
 * 願意為哪一種運具走多遠（格）。
 *
 * 一個全域的上限意味著公車站與捷運站的服務範圍一模一樣，而現實剛好相反：人願意
 * 為捷運多走，因為它快、班次密、而且站本來就稀疏；為一班很久才來一次的公車，走三
 * 分鐘就不肯了 —— 何況公車站密集，本來就不必走遠。
 *
 * 這個上限是「絕對走不到」的硬邊界，不是行為規則。細部取捨由時間本身處理：走路的
 * 時間會進到模式比較裡，還要再乘一份不情願（見 `citizen/WalkWillingness`）。所以
 * 這裡不必也不該調得很精細 —— 它只負責砍掉不合理的遠端，順便框住步行涵蓋範圍的
 * 搜尋半徑。
 */
export const WALK_RANGE_BY_TYPE = {
  BY_TYPE: {
    [TransportType.BUS]: 5,
    [TransportType.METRO]: 12,
    [TransportType.RAIL]: 12,
    [TransportType.FERRY]: 9,
    [TransportType.AIRPORT]: 12,
  } as Record<TransportType, number>,
  FALLBACK: 8,
  /**
   * 最寬的那一個。
   *
   * 站牌的步行涵蓋範圍是一站算一次、算過就快取，快取的鍵含半徑 —— 各運具各用各的
   * 半徑會讓同一個站牌算好幾份。統一用最寬的算一次，各運具再各自截斷。
   */
  WIDEST: 12,
} as const;

/** 這種運具的步行上限（格）。 */
export function walkRangeFor(type: TransportType): number {
  return WALK_RANGE_BY_TYPE.BY_TYPE[type] ?? WALK_RANGE_BY_TYPE.FALLBACK;
}

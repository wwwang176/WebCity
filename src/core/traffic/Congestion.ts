/**
 * 舊的壅塞模型:`車輛數 / 容量` 換成速度倍率。
 *
 * **目前沒有任何生產端程式碼引用這個模組。** 它有一整套測試在跑，所以看起來像活的 ——
 * 這一段註解就是為了讓下一個人不會照著它去改東西。
 *
 * 現在的壅塞從**需求**算（每一格上有多少人的通勤路線經過），而且是逐路線的，
 * 見 `RouteCongestion.ts` 與 `docs/traffic-system.md` 的「壅塞」一節。
 *
 * 留著而不刪掉是因為那組門檻／倍率表本身是有用的形狀，日後若要做「路段速度隨壅塞下降」
 * 可以直接接上去。要刪的話連同 `Congestion.test.ts` 一起。
 */

/** Congestion thresholds and speed multipliers */
export const CONGESTION = {
  LOW_THRESHOLD: 0.5,
  MEDIUM_THRESHOLD: 0.8,
  HIGH_THRESHOLD: 1.0,
  MEDIUM_SPEED: 0.8,
  HIGH_SPEED: 0.5,
  MIN_SPEED: 0.05,
} as const;

export function getCongestionRate(vehicleCount: number, capacity: number): number {
  if (capacity <= 0) return 1;
  return vehicleCount / capacity;
}

export function getSpeedMultiplier(congestionRate: number): number {
  if (congestionRate <= CONGESTION.LOW_THRESHOLD) return 1;
  if (congestionRate <= CONGESTION.MEDIUM_THRESHOLD) return CONGESTION.MEDIUM_SPEED;
  if (congestionRate <= CONGESTION.HIGH_THRESHOLD) return CONGESTION.HIGH_SPEED;
  return Math.max(CONGESTION.MIN_SPEED, 1 - congestionRate);
}

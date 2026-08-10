/**
 * 道路通行成本 —— 主執行緒與 Worker 共用的**唯一**來源。
 *
 * 這個模組刻意做成葉節點（只 import `./types`），這樣
 * `workplace-distance.worker.ts` 可以直接引用而不會把整個服務層拖進 worker
 * bundle。在此之前 worker 裡有一份手抄的 `roadTileCost`，兩邊各改一次就會
 * 悄悄分岔。
 *
 * ## 為什麼成本是整數
 *
 * 每格成本 = `BASE_COST / (speedLimit × 車道數/2)`。分母有 30、50、100、180、
 * 200 五種，最小公倍數是 1800 —— 把分子取成 1800，六種道路的成本全部落在
 * 9 ~ 60 的整數上。
 *
 * 這不只是好看。浮點加法**沒有結合律**：
 *
 *   10/3 + 10/3 + 10/3 + 2 + 2 === 14
 *   2 + 2 + 10/3 + 10/3 + 10/3 === 14.000000000000002
 *
 * 反向 Dijkstra（從工作地往外擴）與正向 Dijkstra（從家往外擴）走的是同一組
 * 邊、相反的順序，所以舊的浮點成本讓兩者**不可能**逐位元相等 —— 換成
 * Float64 也一樣，這與精度無關。整數加法完全可交換，兩個方向必然相同。
 *
 * 整數化是一次純粹的單位換算：所有預算與門檻同步 ×18，因此涵蓋半徑、
 * 通勤評分、消防反應時間全部不變。見 `__tests__/RoadCostInteger.test.ts`。
 */

import { ROAD_CONFIGS, RoadType } from './types';

/** 服務涵蓋與通行預算。單位與 `roadTileCost` 相同（舊浮點制 × 18）。 */
export const ROAD_COVERAGE = {
  /** 每格成本的分子。1800 = LCM(30, 50, 100, 180, 200)，讓每格成本都是整數。 */
  BASE_COST: 1800,
  GARBAGE_BUDGET: 1440,
  POLICE_BUDGET: 540,
  FIRE_BUDGET: 540,
  HEALTH_BUDGET: 720,
  DEATHCARE_BUDGET: 630,
  EDUCATION_ELEMENTARY_BUDGET: 360,
  EDUCATION_HIGHSCHOOL_BUDGET: 540,
  EDUCATION_UNIVERSITY_BUDGET: 810,
} as const;

/**
 * 單格道路的通行成本。越快、越寬的路成本越低，涵蓋範圍就越遠。
 *
 * 回傳值保證是正整數（不可行駛的 `NONE` 回傳 `Infinity`，那是哨兵值，
 * 呼叫端在加總前就會濾掉）。
 */
export function roadTileCost(roadType: number): number {
  const config = ROAD_CONFIGS[roadType as RoadType];
  if (!config || config.speedLimit === 0) return Infinity;
  const laneFactor = config.lanes / 2; // 2-lane = 1×
  return ROAD_COVERAGE.BASE_COST / (config.speedLimit * laneFactor);
}

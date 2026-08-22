import { ZONE_ROAD_REACH } from '../grid/constants';
import { floodRoadCellGraph, seedNodesFor, type RoadCellGraph } from './RoadCellGraph';

/**
 * 兩格之間走不走得到。
 *
 * ## 為什麼服務覆蓋回答不了這件事
 *
 * 在這之前，唯一能問的是 `read.coverage(x, y)` —— 拿服務覆蓋當連通性的代理。
 * 而覆蓋是**有預算上限的 Dijkstra**（`ROAD_COVERAGE.BASE_COST` 1800、警局 540、
 * 國小 360），走到預算耗盡就停。所以「0 覆蓋」有兩個意思:真的不連通，或者連通
 * 但太遠。蓋了一座橋、橋也接對了，覆蓋照樣可以回 0（BUG-368）。
 *
 * 這一支不設預算上限，所以它的 `false` 就真的是不連通。
 *
 * ## 用的是同一張圖
 *
 * `buildRoadCellGraph` 建出來的那張 —— 服務覆蓋（`RoadCoverageFlood`）與通勤可達性
 * （`SimulationLoop.getCellGraph`）走的都是它。樓層與匝道規則在建圖時就消化掉了，
 * 所以高架與匝道自動算數，下不來的橋自動不算數。
 *
 * ## 成本的單位
 *
 * 與 `ROAD_COVERAGE` 的預算同一把尺（見 `roadCost.ts`），不是格數。所以
 * `cost <= ROAD_COVERAGE.POLICE_BUDGET` 就是「一座警局蓋在這裡罩得到那裡」。
 * 起點自己那一格不計費 —— 成本加在走進去的那一格，跟覆蓋的算法一致。
 */

export interface ConnectivityResult {
  connected: boolean;
  /** 沿馬路走過去的成本。走不到是 `-1`。 */
  cost: number;
}

const NOT_CONNECTED: ConnectivityResult = { connected: false, cost: -1 };

/**
 * @param reach 兩端各自附掛到幾格內的路。預設與分區、公共設施同一個值 ——
 *   建築不是道路格，它靠邊上的路連進路網。
 */
export function roadConnectivity(
  graph: RoadCellGraph,
  from: { x: number; y: number },
  to: { x: number; y: number },
  reach: number = ZONE_ROAD_REACH,
): ConnectivityResult {
  // 起點附近沒有路就不必特別處理 —— 沒有種子的 flood 一個節點都 settle 不了。
  const seeds = seedNodesFor(graph, from.x, from.y, reach);

  const targets = new Set(seedNodesFor(graph, to.x, to.y, reach));
  // 純粹是省力氣的早退。**這是等價變異** —— 拿掉它答案一模一樣，只是會白跑一次
  // 全城 flood。沒有測試守得住它，測試守的是答案。
  if (targets.size === 0) return { ...NOT_CONNECTED };

  let found = -1;
  // settle 的順序就是成本遞增的順序，所以第一個碰到的目標節點就是最便宜的那條路。
  floodRoadCellGraph(graph, seeds, Infinity, (node, cost) => {
    if (!targets.has(node)) return false;
    found = cost;
    return true;
  });

  return found < 0 ? { ...NOT_CONNECTED } : { connected: true, cost: found };
}

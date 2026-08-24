import { ZONE_ROAD_REACH } from '../grid/constants';
import { floodRoadCellGraph, seedNodesFor, type RoadCellGraph } from './RoadCellGraph';

/**
 * Whether two cells are reachable from each other.
 *
 * ## Why service coverage cannot answer this
 *
 * The only question available was `read.coverage(x, y)`, using service coverage as a proxy for
 * connectivity. But coverage is a **budgeted Dijkstra** (`ROAD_COVERAGE.BASE_COST` 1800, police
 * 540, primary school 360) that stops when the budget runs out. So zero coverage has two
 * meanings: genuinely disconnected, or connected but too far. A bridge that was built and
 * connected correctly can still report 0 coverage (BUG-368).
 *
 * This has no budget, so its `false` really means disconnected.
 *
 * ## The same graph
 *
 * The one `buildRoadCellGraph` produces, used by service coverage (`RoadCoverageFlood`) and
 * commute reachability (`SimulationLoop.getCellGraph`) alike. Level and ramp rules are consumed
 * at build time, so elevated roads and ramps count automatically and a bridge with no way down
 * automatically does not.
 *
 * ## The unit of cost
 *
 * The same scale as `ROAD_COVERAGE`'s budgets (see `roadCost.ts`), not a cell count. So
 * `cost <= ROAD_COVERAGE.POLICE_BUDGET` answers whether a police station here would reach there.
 * The origin cell itself is not charged: cost is charged on entering a cell, matching coverage.
 */

export interface ConnectivityResult {
  connected: boolean;
  /** The road-following cost of getting there. `-1` when unreachable. */
  cost: number;
}

const NOT_CONNECTED: ConnectivityResult = { connected: false, cost: -1 };

/**
 * @param reach How many cells each end attaches to a road within. Defaults to the value zoning
 *   and civic buildings use: a building is not a road cell and joins the network through a road
 *   beside it.
 */
export function roadConnectivity(
  graph: RoadCellGraph,
  from: { x: number; y: number },
  to: { x: number; y: number },
  reach: number = ZONE_ROAD_REACH,
): ConnectivityResult {
  // No road near the origin needs no special handling: a flood with no seeds settles nothing.
  const seeds = seedNodesFor(graph, from.x, from.y, reach);

  const targets = new Set(seedNodesFor(graph, to.x, to.y, reach));
  // Purely a labour-saving early exit and an **equivalent mutation**: removing it gives the same
  // answer after a wasted city-wide flood. No test guards it; the tests guard the answer.
  if (targets.size === 0) return { ...NOT_CONNECTED };

  let found = -1;
  // Settle order is increasing cost order, so the first target node reached is the cheapest
  // route.
  floodRoadCellGraph(graph, seeds, Infinity, (node, cost) => {
    if (!targets.has(node)) return false;
    found = cost;
    return true;
  });

  return found < 0 ? { ...NOT_CONNECTED } : { connected: true, cost: found };
}

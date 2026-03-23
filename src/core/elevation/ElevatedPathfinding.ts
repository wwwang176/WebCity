import { ROAD_CONFIGS, RoadType } from '../road/types';
import { toPosKey, parsePosKeyUnsafe, parseLevelFromKey, manhattanDistance } from '../grid/GridHelpers';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import { type LaneGraph } from '../traffic/LaneGraph';

/** Cost multiplier for ramp cells (slower due to incline). */
const RAMP_COST_MULTIPLIER = 1.5;
const MAX_SPEED = 100;

/**
 * A* pathfinding using LaneGraph cell-level connectivity as the source of truth.
 * Only traverses cells that have actual LaneGraph edges between them.
 */
export function findElevatedPath(
  _grid: { readonly width: number; readonly height: number; getCell(x: number, y: number): { roadType: number } | null },
  lookup: UnifiedRoadLookup,
  start: { x: number; y: number },
  end: { x: number; y: number },
  maxSteps = 5000,
  laneGraph?: LaneGraph,
): string[] | null {
  const target = toPosKey(end.x, end.y); // destination is always ground level
  const startKey = toPosKey(start.x, start.y);

  const gScore = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const closed = new Set<string>();

  const open: { k: string; x: number; y: number; level: number; f: number }[] = [];

  gScore.set(startKey, 0);
  parent.set(startKey, null);
  const h0 = manhattanDistance(start.x, start.y, end.x, end.y) / MAX_SPEED;
  open.push({ k: startKey, x: start.x, y: start.y, level: 0, f: h0 });

  let steps = 0;

  while (open.length > 0 && steps < maxSteps) {
    steps++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open[bestIdx]!;
    open[bestIdx] = open[open.length - 1]!;
    open.pop();

    if (current.k === target) {
      const path: string[] = [];
      let cur: string | null = target;
      while (cur !== null) {
        path.push(cur);
        cur = parent.get(cur) ?? null;
      }
      path.reverse();
      return path;
    }

    if (closed.has(current.k)) continue;
    closed.add(current.k);

    const currentG = gScore.get(current.k)!;

    // Get neighbors from LaneGraph (source of truth for actual road connections)
    const connectedKeys = laneGraph
      ? laneGraph.getConnectedCellKeys(current.k)
      : lookup.getCompatibleNeighborKeys(current.k, current.x, current.y); // fallback

    for (const nk of connectedKeys) {
      if (closed.has(nk)) continue;

      const roadInfo = lookup.getCellByKey(nk);
      if (!roadInfo) continue;

      const config = ROAD_CONFIGS[roadInfo.roadType as RoadType];
      const speed = config?.speedLimit || 50;
      const isRamp = lookup.isRamp(nk);
      const moveCost = isRamp ? (1 / speed) * RAMP_COST_MULTIPLIER : 1 / speed;

      const tentativeG = currentG + moveCost;
      const prevG = gScore.get(nk);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(nk, tentativeG);
      parent.set(nk, current.k);
      const nPos = parsePosKeyUnsafe(nk);
      const nLevel = parseLevelFromKey(nk);
      const h = manhattanDistance(nPos.x, nPos.y, end.x, end.y) / MAX_SPEED;
      open.push({ k: nk, x: nPos.x, y: nPos.y, level: nLevel, f: tentativeG + h });
    }
  }

  return null;
}

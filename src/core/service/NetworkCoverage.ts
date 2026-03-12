import { Grid } from '../grid/Grid';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

/**
 * Shared network coverage algorithm used by both PowerGrid and WaterNetwork.
 * Implements Euclidean radius coverage + BFS relay through roads/buildings.
 *
 * 1. All cells within Euclidean distance ≤ `range` are added to `coverageSet`.
 * 2. Relay-capable cells (roads/buildings) on the circle edge relay coverage
 *    `relayRange` further via BFS.
 *
 * @param grid         The game grid
 * @param px           Plant X position
 * @param py           Plant Y position
 * @param range        Euclidean coverage radius
 * @param relayRange   BFS relay range through roads/buildings
 * @param coverageSet  Mutable set to accumulate covered cell keys
 * @param infra        Optional set of infrastructure position keys
 */
export function calculateNetworkCoverage(
  grid: Grid,
  px: number,
  py: number,
  range: number,
  relayRange: number,
  coverageSet: Set<string>,
  infra?: Set<string>,
): void {
  const r = range;
  const r2 = r * r;
  const relaySeeds: [number, number][] = [];

  // Phase 1: Euclidean circle coverage
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = px + dx;
      const ny = py + dy;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      coverageSet.add(toPosKey(nx, ny));

      // Collect relay-capable cells on the circle edge (distance > r-1)
      if (dx * dx + dy * dy > (r - 1) * (r - 1)) {
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(toPosKey(nx, ny));
        if (isRelay) relaySeeds.push([nx, ny]);
      }
    }
  }

  // Phase 2: BFS relay from edge relay cells
  if (relaySeeds.length === 0) return;
  const relayMap = new Map<string, number>();
  const queue: [number, number, number][] = [];
  for (const [sx, sy] of relaySeeds) {
    const key = toPosKey(sx, sy);
    relayMap.set(key, relayRange);
    queue.push([sx, sy, relayRange]);
  }
  while (queue.length > 0) {
    const [x, y, remaining] = queue.shift()!;
    for (const [ddx, ddy] of FOUR_NEIGHBORS) {
      const nx = x + ddx!;
      const ny = y + ddy!;
      const key = toPosKey(nx, ny);
      if (coverageSet.has(key)) continue;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
      // Roads/buildings keep range at relayRange (never decreases below it)
      const newRange = Math.max(isRelay ? relayRange : 0, remaining - 1);
      if (newRange <= 0) continue;
      const prev = relayMap.get(key) ?? 0;
      if (newRange <= prev) continue;
      relayMap.set(key, newRange);
      coverageSet.add(key);
      queue.push([nx, ny, newRange]);
    }
  }
}

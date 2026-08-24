import type { StopReach } from '../../traffic/StopWalkReach';

/**
 * Open ground with no obstacles: every walk distance equals the Manhattan distance.
 *
 * A **test double**, not a second production algorithm — production has only
 * `SidewalkStopReach`. Tests using it check the arithmetic of route selection, transfers
 * and time estimation, and pinning walk distance to a predictable number is what makes an
 * arithmetic error visible.
 *
 * That roads obstruct pedestrians is checked elsewhere, against a real sidewalk graph, by
 * `StopChoiceAcrossRoad.test.ts` and `TransitAccessAcrossRoad.test.ts`.
 */
export const openFieldReach: StopReach = {
  cellsWithin(x, y, maxDist) {
    const cells = new Map<string, number>();
    const r = Math.floor(maxDist);
    for (let dy = -r; dy <= r; dy++) {
      const rest = r - Math.abs(dy);
      for (let dx = -rest; dx <= rest; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cy < 0) continue;
        cells.set(`${cx},${cy}`, Math.abs(dx) + Math.abs(dy));
      }
    }
    return cells;
  },
};

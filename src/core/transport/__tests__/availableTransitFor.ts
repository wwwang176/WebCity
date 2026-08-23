import { flattenSystems } from '../MultiModalRouter';
import { StopProximityIndex } from '../StopProximityIndex';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import type { AvailableTransport } from '../ModeChoice';
import type { StopReach } from '../../traffic/StopWalkReach';

/**
 * 從「運具系統」問到「有哪些選擇」—— 產品裡分成兩步的那條路，測試用一行走完。
 *
 * 產品在路線變動時建一次扁平路線與逐格索引（`rebuildTransferGraphIfDirty`），之後
 * 每個 tick 問幾百次。測試的城市小、只問幾次，每次重建一份反而讀得清楚。
 */
export function availableTransitFor(
  systems: readonly TransitSystemInfo[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  reach: StopReach,
  walkSpeed: number,
  waitFactor: number,
): AvailableTransport[] {
  const routes = flattenSystems(systems);
  const index = StopProximityIndex.build(routes, reach);
  return findAvailableTransit(routes, index, origin, destination, walkSpeed, waitFactor);
}

import { flattenSystems } from '../MultiModalRouter';
import { StopProximityIndex } from '../StopProximityIndex';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import type { AvailableTransport } from '../ModeChoice';
import type { StopReach } from '../../traffic/StopWalkReach';

/**
 * From transit systems to available options in one call: the two-step production path
 * collapsed for tests.
 *
 * Production builds the flat routes and the per-cell index once per route change
 * (`rebuildTransferGraphIfDirty`) and then asks hundreds of times per tick. Test cities are
 * small and ask a few times, so rebuilding per call reads more clearly.
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

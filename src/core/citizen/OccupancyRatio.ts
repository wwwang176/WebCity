import type { Citizen } from './types';
import { countOccupancy } from './OccupancyAssignment';
import { getBuildingType } from '../building/types';

/**
 * Compute occupancy ratios (0.0–1.0) for each building position.
 * Residential buildings use homeId occupancy, workplace buildings use workplaceId.
 * Returns a Map<posKey, ratio> where ratio is clamped to [0, 1].
 *
 * Accepts optional pre-built occupancy maps to avoid redundant iteration.
 */
export function computeOccupancyRatios(
  citizens: readonly Citizen[],
  buildings: readonly { pos: string; buildingId: number }[],
  prebuiltHome?: ReadonlyMap<string, number>,
  prebuiltWork?: ReadonlyMap<string, number>,
): Map<string, number> {
  const ratios = new Map<string, number>();
  if (buildings.length === 0) return ratios;

  const homeOcc = prebuiltHome ?? countOccupancy(citizens, (c) => c.homeId);
  const workOcc = prebuiltWork ?? countOccupancy(citizens, (c) => c.workplaceId);

  for (const b of buildings) {
    const bt = getBuildingType(b.buildingId);
    if (!bt) continue;

    let capacity: number;
    let occupied: number;

    if (bt.residents > 0) {
      capacity = bt.residents;
      occupied = homeOcc.get(b.pos) ?? 0;
    } else if (bt.workers > 0) {
      capacity = bt.workers;
      occupied = workOcc.get(b.pos) ?? 0;
    } else {
      continue;
    }

    ratios.set(b.pos, Math.min(1.0, occupied / capacity));
  }

  return ratios;
}

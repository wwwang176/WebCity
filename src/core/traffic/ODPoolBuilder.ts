import { isWorkingAge } from '../citizen/types';

export interface WeightedCell {
  x: number;
  y: number;
  weight: number;
}

export interface ODPools {
  residential: WeightedCell[];
  destinations: WeightedCell[];
  totalResWeight: number;
  totalDestWeight: number;
}

export interface CommutingCitizen {
  age: number;
  homeId: string | null;
  workplaceId: string | null;
}

/**
 * Build weighted origin-destination pools from citizen data.
 * Groups citizens by home position (origins) and workplace position (destinations),
 * returning weighted pools for congestion flow sampling.
 *
 * Returns null if no valid OD pairs exist.
 */
export function buildODPools(
  citizens: Iterable<CommutingCitizen>,
  parsePos: (key: string) => { x: number; y: number },
): ODPools | null {
  const resMap = new Map<string, number>();
  const destMap = new Map<string, number>();

  for (const c of citizens) {
    if (!isWorkingAge(c.age)) continue;
    if (!c.homeId || !c.workplaceId) continue;
    resMap.set(c.homeId, (resMap.get(c.homeId) ?? 0) + 1);
    destMap.set(c.workplaceId, (destMap.get(c.workplaceId) ?? 0) + 1);
  }

  const residential: WeightedCell[] = [];
  const destinations: WeightedCell[] = [];
  let totalResWeight = 0;
  let totalDestWeight = 0;

  for (const [posKey, weight] of resMap) {
    const { x, y } = parsePos(posKey);
    residential.push({ x, y, weight });
    totalResWeight += weight;
  }
  for (const [posKey, weight] of destMap) {
    const { x, y } = parsePos(posKey);
    destinations.push({ x, y, weight });
    totalDestWeight += weight;
  }

  if (residential.length === 0 || destinations.length === 0) return null;

  return { residential, destinations, totalResWeight, totalDestWeight };
}

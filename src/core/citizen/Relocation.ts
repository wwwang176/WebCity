import type { Citizen } from './types';
import { type HousingCandidate, scoreHousing } from './HousingScore';

export interface RelocationConfig {
  happinessThreshold: number;  // 35
  scoreGap: number;            // 20
  maxRelocateRatio: number;    // 0.05
  tickInterval: number;        // 60
}

export const DEFAULT_RELOCATION_CONFIG: RelocationConfig = {
  happinessThreshold: 35,
  scoreGap: 20,
  maxRelocateRatio: 0.05,
  tickInterval: 60,
};

/**
 * Attempt to relocate unhappy citizens to better housing.
 * Returns the number of citizens that were relocated.
 * Mutates citizens (homeId) and occupancy map in-place.
 */
export function relocationTick(
  citizens: Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
  config?: Partial<RelocationConfig>,
): { count: number; relocatedIds: number[] } {
  const cfg: RelocationConfig = config
    ? { ...DEFAULT_RELOCATION_CONFIG, ...config }
    : DEFAULT_RELOCATION_CONFIG;

  if (candidates.length === 0) return { count: 0, relocatedIds: [] };

  // Count unhappy citizens inline (avoid .filter() array allocation)
  let unhappyCount = 0;
  for (const c of citizens) {
    if (c.homeId !== null && c.happiness < cfg.happinessThreshold) unhappyCount++;
  }
  if (unhappyCount === 0) return { count: 0, relocatedIds: [] };

  // Cap the number of relocations per tick
  const maxRelocations = Math.max(1, Math.floor(unhappyCount * cfg.maxRelocateRatio));
  const relocatedIds: number[] = [];

  for (const citizen of citizens) {
    if (relocatedIds.length >= maxRelocations) break;
    if (citizen.homeId === null || citizen.happiness >= cfg.happinessThreshold) continue;

    const currentPos = citizen.homeId;

    // Find the current home candidate to compute current score
    const currentCandidate = candidates.find(c => c.pos === currentPos);
    if (!currentCandidate) continue;
    const currentScore = scoreHousing(citizen, currentCandidate);

    // Score alternatives inline (avoid .filter() array allocation)
    let bestCandidate: HousingCandidate | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (c.pos === currentPos) continue;
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ >= c.capacity) continue;
      const s = scoreHousing(citizen, c);
      if (s > bestScore) {
        bestScore = s;
        bestCandidate = c;
      }
    }

    if (bestCandidate === null) continue;

    // Only relocate if the score gap is large enough
    if (bestScore - currentScore < cfg.scoreGap) continue;

    // Perform relocation
    const oldOcc = occupancy.get(currentPos) ?? 0;
    occupancy.set(currentPos, Math.max(0, oldOcc - 1));

    citizen.homeId = bestCandidate.pos;
    occupancy.set(bestCandidate.pos, (occupancy.get(bestCandidate.pos) ?? 0) + 1);

    relocatedIds.push(citizen.id);
  }

  return { count: relocatedIds.length, relocatedIds };
}

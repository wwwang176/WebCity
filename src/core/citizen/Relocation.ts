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
 *
 * ### Why `inSlice` exists
 *
 * The expensive part is **evaluation**, not relocation: every unhappy citizen scores every
 * candidate home in the city, and only those with a large enough score difference actually move.
 * Relocation is capped at 5% and evaluation is not — citizens who do not move are not counted
 * against the cap — so the cost is O(unhappy x homes). One pass measured **195ms** at 120,000
 * citizens against the 250ms a tick has at speed 1 (BUG-331).
 *
 * `inSlice` lets the caller bring **part of the population** to each evaluation. The rhythm
 * becomes more frequent meetings with fewer people rather than one meeting spread across dozens
 * of days.
 *
 * Spreading one meeting across dozens of days was wrong: candidate homes, occupancy and who is
 * still alive all change during those ticks, and carrying the first day's data through to the
 * last moves people into demolished buildings, into full ones, or moves the dead. Three rounds of
 * patches kept producing new ones (BUG-331).
 *
 * Each call is now an **independent meeting**: the snapshot is taken, used and discarded within
 * one tick — exactly as originally written, and that class of problem does not exist.
 *
 * ### Quota
 *
 * Without a `quota`, the cap is 5% of the unhappy citizens seen this call, exactly as before
 * slicing.
 *
 * A slicing caller **must compute `quota` itself**. Taking 5% per slice does not sum to 5% of the
 * city: `Math.max(1, Math.floor(n * 0.05))` rounds within each slice, so 100 unhappy citizens in
 * ten slices of 10 become `max(1, floor(0.5)) = 1` each and 10 per round, against
 * `floor(100 * 0.05) = 5` in one pass — **twice as many**. Smaller cities are worse.
 *
 * With a `quota` given, nothing is counted here, so `inSlice` is asked about each citizen exactly
 * once and need not be pure.
 */
export function relocationTick(
  // Read-only: the pass rewrites `homeId` on the citizens, never the array.
  citizens: readonly Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
  config?: Partial<RelocationConfig>,
  /** Whether this citizen is in this slice. Omitted means everyone. */
  inSlice: (citizen: Citizen) => boolean = () => true,
  /** The most citizens this call may move. Omitted, it counts them itself (see Quota above). */
  quota?: number,
): { count: number; relocatedIds: number[] } {
  const cfg: RelocationConfig = config
    ? { ...DEFAULT_RELOCATION_CONFIG, ...config }
    : DEFAULT_RELOCATION_CONFIG;

  if (candidates.length === 0) return { count: 0, relocatedIds: [] };

  let maxRelocations: number;
  if (quota === undefined) {
    // Count unhappy citizens inline (avoid .filter() array allocation)
    let unhappyCount = 0;
    for (const c of citizens) {
      if (c.homeId !== null && c.happiness < cfg.happinessThreshold && inSlice(c)) unhappyCount++;
    }
    if (unhappyCount === 0) return { count: 0, relocatedIds: [] };
    maxRelocations = Math.max(1, Math.floor(unhappyCount * cfg.maxRelocateRatio));
  } else {
    maxRelocations = quota;
  }
  if (maxRelocations <= 0) return { count: 0, relocatedIds: [] };
  const relocatedIds: number[] = [];

  // The current home was a linear `candidates.find` per citizen.
  // A candidate's `pos` must be unique, which `buildHousingCandidates` gives naturally with one
  // entry per cell. With duplicates, `find` takes the first while a Map keeps the last, and the
  // current home would score differently.
  const byPos = new Map<string, HousingCandidate>();
  for (const c of candidates) byPos.set(c.pos, c);

  for (const citizen of citizens) {
    if (relocatedIds.length >= maxRelocations) break;
    if (citizen.homeId === null || citizen.happiness >= cfg.happinessThreshold) continue;
    if (!inSlice(citizen)) continue;

    const currentPos = citizen.homeId;

    // Find the current home candidate to compute current score
    const currentCandidate = byPos.get(currentPos);
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

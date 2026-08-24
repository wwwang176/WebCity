import type { LoadDemand, LoadDistributionResult } from './StationLoadDistributor';

/**
 * Nearest first, spilling to the next when full — the hearse rule.
 *
 * ## Why the nearest facility alone will not do
 *
 * Attributing every cell's demand to the facility cheapest to reach by road fixes the
 * straight-line problem and creates another: **everyone crowds into the nearest one and the
 * second-nearest stays empty**, even where it plainly covers the same area. A hospital reads
 * 230% while the one next door sits at 0% (BUG-365).
 *
 * The game already had one instance that got this right — bin lorries and hearses
 * (`GlobalCoverageService.collectPending`):
 *
 * ```ts
 * for (const [id, state] of facState) {
 *   if (state.budget <= 0 || state.room <= 0) continue;   // skip the full ones
 *   const cost = this.facilityDistanceMaps.get(id).get(posKey);
 *   if (cost !== undefined && cost < bestCost) { ... }     // nearest of the rest
 * }
 * ```
 *
 * Three things: **only facilities that cover that cell**, **move on when full**, and **pick the
 * nearest of those with room**. This applies the same rule to police, fire, health and schools.
 *
 * ## Who picks first
 *
 * Demands are processed by how close their own nearest facility is, nearest first, so the
 * neighbourhood next to a hospital claims it before more distant demand spills to the
 * second-nearest. The reverse would let an outlying block fill a downtown hospital first, which
 * matches no real pattern of seeking care.
 *
 * The order is **deterministic**, tie-broken by id rather than randomised: this allocation is
 * recomputed every 6 ticks, and randomness would make the panel's numbers jitter on their own.
 * The hearse code uses weighted randomness because it performs **actual collection** with a
 * per-tick budget rather than taking a statistical snapshot.
 *
 * ## When everything is full
 *
 * The remainder is attributed to the **nearest** facility. Hard-capping at capacity would mean
 * no facility ever exceeds 100%, and overload is the whole reason these numbers exist.
 */

export interface SpilloverFacility {
  id: string;
  capacity: number;
}

/** The facilities covering one cell, **nearest first**. */
export interface CoveringFacility {
  id: string;
  cost: number;
}

export function distributeWithSpillover(
  facilities: readonly SpilloverFacility[],
  demands: readonly LoadDemand[],
  loadMap: Map<string, number>,
  coveringOf: (x: number, y: number) => readonly CoveringFacility[],
): LoadDistributionResult {
  loadMap.clear();

  let total = 0;
  for (let i = 0; i < demands.length; i++) total += demands[i]!.weight;

  if (facilities.length === 0) {
    return { loadRatio: total > 0 ? Infinity : 0, unassigned: total };
  }

  /** Remaining room. A facility with zero capacity starts full. */
  const room = new Map<string, number>();
  let cap = 0;
  for (const f of facilities) {
    loadMap.set(f.id, 0);
    room.set(f.id, f.capacity);
    cap += f.capacity;
  }

  // Each demand asks which facilities cover it, then queues by the distance to its nearest one.
  const queue: { weight: number; covering: readonly CoveringFacility[] }[] = [];
  let unassigned = 0;
  for (const d of demands) {
    // Only facilities that count this round stay on the list: one demolished or cut off after
    // coverage was computed cannot take demand.
    const covering = coveringOf(d.x, d.y).filter(c => room.has(c.id));
    if (covering.length === 0) {
      unassigned += d.weight;
      continue;
    }
    queue.push({ weight: d.weight, covering });
  }
  queue.sort((a, b) => {
    const byCost = a.covering[0]!.cost - b.covering[0]!.cost;
    // Ties break on id; without it the order follows the caller's loop and the numbers jitter.
    return byCost !== 0 ? byCost : a.covering[0]!.id.localeCompare(b.covering[0]!.id);
  });

  for (const item of queue) {
    let left = item.weight;
    for (const c of item.covering) {
      if (left <= 0) break;
      const free = room.get(c.id)!;
      if (free <= 0) continue;
      const take = Math.min(left, free);
      loadMap.set(c.id, loadMap.get(c.id)! + take);
      room.set(c.id, free - take);
      left -= take;
    }
    // Everything is full. The remainder goes to the nearest facility: truncating would mean
    // nobody ever exceeds 100%, and overload is what these numbers are for.
    if (left > 0) {
      const nearest = item.covering[0]!.id;
      loadMap.set(nearest, loadMap.get(nearest)! + left);
    }
  }

  return {
    loadRatio: cap > 0 ? total / cap : (total > 0 ? Infinity : 0),
    unassigned,
  };
}

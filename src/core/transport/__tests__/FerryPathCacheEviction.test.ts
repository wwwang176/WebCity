import { describe, it, expect } from 'vitest';
import { FerrySystem } from '../FerrySystem';
import type { WaterGrid } from '../../pathfinding/WaterPathfinder';

/**
 * waterPathCache is keyed by dock COORDINATES, and nothing evicted an entry
 * when the dock at those coordinates went away.
 *
 * BUG-089 fixed the vesselPaths leak on the route-dissolve path, but the cache
 * itself is a separate map with a separate lifetime: every dock the player ever
 * builds and demolishes leaves its A* results behind forever. Worse than the
 * memory, the entries are stale — build a dock, demolish it, reshape the water,
 * and a dock rebuilt on the same tile answers connectivity questions from the
 * old map.
 */
class MutableWater implements WaterGrid {
  readonly width = 20;
  readonly height = 20;
  /** Cells that are LAND. Everything else is water. */
  land = new Set<string>();
  isWater(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return !this.land.has(`${x},${y}`);
  }
}

function ferryWithTwoDocks() {
  const water = new MutableWater();
  const ferry = new FerrySystem();
  ferry.setWaterGrid(water);
  const a = ferry.addDock(2, 2)!;
  const b = ferry.addDock(2, 10)!;
  return { water, ferry, a, b };
}

describe('the ferry water-path cache forgets a demolished dock', () => {
  it('should find a route across open water', () => {
    const { ferry, a, b } = ferryWithTwoDocks();
    expect(ferry.validateRouteConnectivity([a, b])).toBe(true);
  });

  it('should re-evaluate a rebuilt dock against the water as it is now', () => {
    const { water, ferry, a, b } = ferryWithTwoDocks();
    expect(ferry.validateRouteConnectivity([a, b])).toBe(true);

    // Demolish the far dock, then dam the channel. setWaterGrid is NOT called —
    // that clears the whole cache and would mask the leak; terrain edits during
    // play mutate the same grid object.
    ferry.removeDock(b.id);
    for (let y = 0; y < water.height; y++) water.land.add(`5,${y}`);
    for (let x = 0; x < water.width; x++) water.land.add(`${x},6`);

    const rebuilt = ferry.addDock(2, 10)!;

    expect(ferry.validateRouteConnectivity([a, rebuilt])).toBe(false);
  });

  it('should keep answering for docks that were never removed', () => {
    // Negative control: eviction must be scoped to the dock that went away, not
    // a blanket cache clear on every demolition.
    //
    // The dam has to actually CUT a<->b for this to prove anything. The first
    // version dammed x=7, which the (2,2)<->(2,10) path never approached — so
    // the answer was true whether the cache was scoped, untouched, or wiped
    // wholesale, and the case constrained nothing at all. Cutting the channel
    // means only a RETAINED entry can still answer `true`.
    const water = new MutableWater();
    const ferry = new FerrySystem();
    ferry.setWaterGrid(water);
    const a = ferry.addDock(2, 2)!;
    const b = ferry.addDock(2, 10)!;
    const c = ferry.addDock(10, 2)!;
    expect(ferry.validateRouteConnectivity([a, b])).toBe(true);

    // Remove an unrelated dock, then cut the water between the two that stayed.
    ferry.removeDock(c.id);
    for (let x = 0; x < water.width; x++) water.land.add(`${x},6`);

    // Neither a nor b went anywhere, so their entry must not have been evicted
    // — a blanket clear would recompute here and answer false.
    expect(ferry.validateRouteConnectivity([a, b])).toBe(true);
  });

  it('should drop a dissolved route path when its last dock goes', () => {
    const { water, ferry, a, b } = ferryWithTwoDocks();
    ferry.createRoute([a, b], 1);
    ferry.removeDock(b.id);
    for (let x = 0; x < water.width; x++) water.land.add(`${x},6`);

    const rebuilt = ferry.addDock(2, 10)!;

    expect(ferry.validateRouteConnectivity([a, rebuilt])).toBe(false);
  });
});

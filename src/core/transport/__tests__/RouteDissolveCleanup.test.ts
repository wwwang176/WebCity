import { describe, it, expect } from 'vitest';
import { FerrySystem, type WaterChecker } from '../FerrySystem';
import type { WaterGrid } from '../../pathfinding/WaterPathfinder';

/**
 * BaseTransportSystem.removeStop filtered the dissolved route's vehicles out of
 * this.vehicles BEFORE invoking onRouteDissolved. FerrySystem's override walks
 * this.vehicles to decide which vesselPaths entries to drop, so it always found
 * none and the paths leaked.
 *
 * RailSystem and BusSystem key their per-route state by routeId and so were
 * unaffected — which is exactly why this survived: the two subclasses that had
 * tests did not depend on the ordering (BUG-089).
 */
function createWaterEnv(rows: string[]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const grid: WaterGrid = {
    width, height,
    isWater: (x, y) => x >= 0 && x < width && y >= 0 && y < height && rows[y]![x] === 'W',
  };
  const checker: WaterChecker = {
    isWater: (x, y) => {
      if (grid.isWater(x, y)) return false;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.isWater(x + dx!, y + dy!)) return true;
      }
      return false;
    },
  };
  return { grid, checker };
}

/** A ferry with one route, ticked until its vessel is under way with a path. */
function sailingFerry() {
  const { grid, checker } = createWaterEnv(['LWWWWWWWWL']);
  const ferry = new FerrySystem();
  ferry.setWaterGrid(grid);
  const d1 = ferry.addDock(0, 0, checker)!;
  const d2 = ferry.addDock(9, 0, checker)!;
  ferry.createRoute([d1, d2], 1);

  // Tick past the dwell period so the vessel departs and onDepart stores a path.
  let vesselId = -1;
  for (let i = 0; i < 20; i++) {
    ferry.tick();
    const v = ferry.getVessels()[0];
    if (v && ferry.getVesselPath(v.id)) { vesselId = v.id; break; }
  }
  return { ferry, d1, vesselId };
}

describe('onRouteDissolved can still see the route vehicles', () => {
  it('should have a vessel path to leak in the first place', () => {
    const { vesselId } = sailingFerry();
    expect(vesselId).toBeGreaterThanOrEqual(0);
  });

  it('should drop vesselPaths when a route dissolves via stop removal', () => {
    const { ferry, d1, vesselId } = sailingFerry();
    expect(ferry.getVesselPath(vesselId)).not.toBeNull();

    // Removing one of two docks leaves a single stop, dissolving the route.
    ferry.removeDock(d1.id);

    expect(ferry.getVesselPath(vesselId)).toBeNull();
  });

  it('should still remove the vehicles themselves', () => {
    const { ferry, d1 } = sailingFerry();
    ferry.removeDock(d1.id);
    expect(ferry.getVessels()).toHaveLength(0);
  });
});

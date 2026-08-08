import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import { TransportType, type TransportStop } from '../types';
import type { LaneEdge } from '../../traffic/LaneGraph';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';
import type { TrafficSimulation, Vehicle } from '../../traffic/TrafficSimulation';

/** A bus stop with every field the system reads, not just the ones a case sets. */
function makeBusStop(overrides: Partial<TransportStop> & Pick<TransportStop, 'id' | 'x' | 'y'>): TransportStop {
  return {
    type: TransportType.BUS, passengers: 0,
    dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
    ...overrides,
  };
}

/** Minimal grid stub for findAdjacentRoadCell. */
function makeGrid(roads: Set<string>) {
  return {
    getCell(x: number, y: number) {
      const key = `${x},${y}`;
      return { roadType: roads.has(key) ? 2 : 0, buildingId: 0, railType: 0 };
    },
    width: 20,
    height: 20,
  };
}

function makeFakeLaneEdge(fromX: number, fromY: number, toX: number, toY: number): LaneEdge {
  return makeCellEdge(`${fromX},${fromY}`, `${toX},${toY}`);
}

function fakeTraffic(): TrafficSimulation {
  return {
    vehicles: [] as Vehicle[],
    addBusVehicle: () => ({ id: 1 } as Vehicle),
    removeBusVehicles: () => {},
  } as any;
}

describe('BusSystem.onRoadChanged updates stop roadX/roadY', () => {
  it('should re-resolve bus stop roadX/roadY when adjacent road changes', () => {
    const bus = new BusSystem();

    // Stop at (3,5), originally adjacent road at (4,5)
    const stop = makeBusStop({ id: 1, x: 3, y: 5, roadX: 4, roadY: 5 });
    const stop2 = makeBusStop({ id: 2, x: 7, y: 5, roadX: 7, roadY: 6 });

    // Create route manually
    const route = bus.createRoute([stop, stop2], 1);

    // Compute initial segments
    const initialEdge = makeFakeLaneEdge(4, 5, 7, 6);
    const segments = bus.computeRouteSegments(
      route,
      () => [initialEdge],
    );
    expect(segments).not.toBeNull();

    // Now road at (4,5) is removed and a new road is at (3,6)
    // After road change, grid has road at (3,6) adjacent to stop (3,5)
    const newRoads = new Set(['3,6', '7,6']);
    const grid = makeGrid(newRoads);

    const newEdge = makeFakeLaneEdge(3, 6, 7, 6);
    const affectedCells = new Set(['4,5']); // the old road cell that was affected

    bus.onRoadChanged(
      affectedCells,
      () => [newEdge],
      fakeTraffic(),
      grid,
    );

    // Stop's roadX/roadY should be updated to the new adjacent road
    const updatedStops = route.stops;
    const updatedStop = updatedStops.find(s => s.id === 1)!;
    expect(updatedStop.roadX).toBe(3);
    expect(updatedStop.roadY).toBe(6);
  });
});

/**
 * A cross-intersection turn edge does not stop at the intersection: it goes
 * from the cell before it to the cell after, and records the cell it skipped in
 * `viaCellKey`. The affected-cell scan compared only `from.cellKey` and
 * `to.cellKey`, so demolishing the intersection a bus route turns through never
 * marked that route as affected. Its segments were never recomputed, and the
 * buses went on driving an edge whose middle no longer existed.
 */
describe('a route is recomputed when the cell it turns through is demolished', () => {
  /** Two stops joined by a single edge that turns through (5,5). */
  function routeTurningThrough(via: string) {
    const bus = new BusSystem();
    const route = bus.createRoute([
      makeBusStop({ id: 1, x: 4, y: 4, roadX: 4, roadY: 5 }),
      makeBusStop({ id: 2, x: 6, y: 6, roadX: 6, roadY: 5 }),
    ], 1);
    const edge = makeCellEdge('4,5', '6,5', 0, { type: 'turn', viaCellKey: via });
    expect(bus.computeRouteSegments(route, () => [edge])).not.toBeNull();
    return { bus, route, edge };
  }

  it('should notice a change at the via cell', () => {
    const { bus, route } = routeTurningThrough('5,5');

    // The intersection is gone, so no path can be found any more.
    const suspended = bus.onRoadChanged(new Set(['5,5']), () => null, fakeTraffic());

    expect(suspended, 'the route was never even looked at').toContain(route.id);
    expect(route.suspended).toBe(true);
  });

  it('should still notice a change at an endpoint', () => {
    // The control: the from/to comparison must not have been lost.
    const { bus, route } = routeTurningThrough('5,5');
    const suspended = bus.onRoadChanged(new Set(['4,5']), () => null, fakeTraffic());
    expect(suspended).toContain(route.id);
  });

  it('should leave a route alone when nothing it uses changed', () => {
    // ...and the via check must not make every route recompute on every edit.
    const { bus, route } = routeTurningThrough('5,5');
    const suspended = bus.onRoadChanged(new Set(['19,19']), () => null, fakeTraffic());
    expect(suspended).toEqual([]);
    expect(route.suspended).toBeFalsy();
  });

  it('should not be confused by an edge with no via cell', () => {
    const { bus, route } = routeTurningThrough('');
    const suspended = bus.onRoadChanged(new Set(['']), () => null, fakeTraffic());
    expect(suspended).toEqual([]);
    expect(route.suspended).toBeFalsy();
  });
});

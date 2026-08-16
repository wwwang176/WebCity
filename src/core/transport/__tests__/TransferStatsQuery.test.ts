import { describe, it, expect } from 'vitest';
import {
  computeTransferStats,
  findTransferRouteStops,
  TRANSIT_ICONS,
  type TransferStatsInput,
} from '../TransferStatsQuery';
import { PedestrianTripType } from '../../traffic/PedestrianAgent';

function makeInput(overrides: Partial<TransferStatsInput> = {}): TransferStatsInput {
  return {
    transferTracker: {
      getPedsSnapshot: () => 0,
      getAllWeeklyTotals: () => new Map(),
    },
    walkingTripPool: { trips: [], totalWeight: 0, prefixSums: [] },
    stopRouteCache: new Map(),
    totalActivePeds: 0,
    transferEdgeCount: 0,
    ...overrides,
  };
}

describe('TRANSIT_ICONS', () => {
  it('contains icons for all transit types', () => {
    expect(TRANSIT_ICONS.BUS).toBeDefined();
    expect(TRANSIT_ICONS.METRO).toBeDefined();
    expect(TRANSIT_ICONS.RAIL).toBeDefined();
    expect(TRANSIT_ICONS.FERRY).toBeDefined();
  });
});

describe('computeTransferStats', () => {
  it('returns zeros for empty inputs', () => {
    const stats = computeTransferStats(makeInput());
    expect(stats.activeTransferPeds).toBe(0);
    expect(stats.totalActivePeds).toBe(0);
    expect(stats.transferTrips).toBe(0);
    expect(stats.cachedRoutes).toBe(0);
    expect(stats.multiRideRoutes).toBe(0);
    expect(stats.transferEdges).toBe(0);
    expect(stats.routeBreakdown).toEqual([]);
  });

  it('counts transfer walk trips from pool', () => {
    const stats = computeTransferStats(makeInput({
      walkingTripPool: {
        trips: [
          { fromX: 0, fromY: 0, toX: 1, toY: 1, tripType: PedestrianTripType.TRANSFER_WALK, count: 5 },
          { fromX: 2, fromY: 2, toX: 3, toY: 3, tripType: PedestrianTripType.FULL_WALK, count: 10 },
        ],
        totalWeight: 15,
        prefixSums: [5, 15],
      },
    }));
    expect(stats.transferTrips).toBe(5);
  });

  it('reports activeTransferPeds from tracker', () => {
    const stats = computeTransferStats(makeInput({
      transferTracker: {
        getPedsSnapshot: () => 42,
        getAllWeeklyTotals: () => new Map(),
      },
    }));
    expect(stats.activeTransferPeds).toBe(42);
  });

  it('counts multi-ride routes and builds breakdown', () => {
    const cache = new Map();
    cache.set('route1', {
      totalTime: 10, walkTime: 0,
      legs: [
        { type: 'walk', fromX: 0, fromY: 0, toX: 1, toY: 1 },
        { type: 'ride', fromX: 1, fromY: 1, toX: 5, toY: 5, transitType: 'BUS' },
        { type: 'walk', fromX: 5, fromY: 5, toX: 6, toY: 6 },
        { type: 'ride', fromX: 6, fromY: 6, toX: 10, toY: 10, transitType: 'METRO' },
      ],
    });
    const stats = computeTransferStats(makeInput({
      stopRouteCache: cache,
      transferTracker: {
        getPedsSnapshot: () => 0,
        getAllWeeklyTotals: () => new Map([
          [`${TRANSIT_ICONS.BUS}\u2192${TRANSIT_ICONS.METRO}`, 25],
        ]),
      },
    }));
    expect(stats.cachedRoutes).toBe(1);
    expect(stats.multiRideRoutes).toBe(1);
    expect(stats.routeBreakdown.length).toBe(1);
    expect(stats.routeBreakdown[0]!.rides).toBe(2);
    expect(stats.routeBreakdown[0]!.weeklyUse).toBe(25);
  });

  it('sorts breakdown by weeklyUse descending', () => {
    const cache = new Map();
    cache.set('r1', {
      totalTime: 10, walkTime: 0,
      legs: [
        { type: 'ride', fromX: 0, fromY: 0, toX: 1, toY: 1, transitType: 'BUS' },
        { type: 'ride', fromX: 1, fromY: 1, toX: 2, toY: 2, transitType: 'METRO' },
      ],
    });
    cache.set('r2', {
      totalTime: 5, walkTime: 0,
      legs: [
        { type: 'ride', fromX: 0, fromY: 0, toX: 1, toY: 1, transitType: 'RAIL' },
        { type: 'ride', fromX: 1, fromY: 1, toX: 2, toY: 2, transitType: 'FERRY' },
      ],
    });
    const stats = computeTransferStats(makeInput({
      stopRouteCache: cache,
      transferTracker: {
        getPedsSnapshot: () => 0,
        getAllWeeklyTotals: () => new Map([
          [`${TRANSIT_ICONS.BUS}\u2192${TRANSIT_ICONS.METRO}`, 10],
          [`${TRANSIT_ICONS.RAIL}\u2192${TRANSIT_ICONS.FERRY}`, 50],
        ]),
      },
    }));
    expect(stats.routeBreakdown[0]!.weeklyUse).toBe(50);
    expect(stats.routeBreakdown[1]!.weeklyUse).toBe(10);
  });
});

describe('findTransferRouteStops', () => {
  it('returns empty array when no matching route', () => {
    const cache = new Map();
    const stops = findTransferRouteStops(cache, 'nonexistent');
    expect(stops).toEqual([]);
  });

  it('returns stops for matching label', () => {
    const label = `${TRANSIT_ICONS.BUS}\u2192${TRANSIT_ICONS.METRO}`;
    const cache = new Map();
    cache.set('route1', {
      totalTime: 10, walkTime: 0,
      legs: [
        { type: 'walk', fromX: 0, fromY: 0, toX: 1, toY: 1 },
        { type: 'ride', fromX: 1, fromY: 1, toX: 5, toY: 5, transitType: 'BUS' },
        { type: 'ride', fromX: 5, fromY: 5, toX: 10, toY: 10, transitType: 'METRO' },
      ],
    });
    const stops = findTransferRouteStops(cache, label);
    expect(stops.length).toBeGreaterThan(0);
    // Each leg produces 2 stops (from + to)
    expect(stops.length).toBe(6); // 3 legs × 2
  });
});

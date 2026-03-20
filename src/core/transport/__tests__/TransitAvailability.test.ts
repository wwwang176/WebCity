import { describe, it, expect } from 'vitest';
import { findAvailableTransit, getRouteDailyRiders, type TransitSystemInfo } from '../TransitAvailability';
import { TransportType, type TransportStop } from '../types';

function makeStop(x: number, y: number, id = 1): TransportStop {
  return { id, x, y, type: TransportType.BUS, passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0 };
}

describe('findAvailableTransit', () => {
  it('returns empty array when no transit systems exist', () => {
    const result = findAvailableTransit([], { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toEqual([]);
  });

  it('returns empty array when no route has stops near both origin and destination', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS, stops: [makeStop(50, 50), makeStop(60, 60)],
        vehicles: 1, frequency: 4, operatingCost: 100,
      }],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toEqual([]);
  });

  it('returns transport option when route has stops near both origin and destination', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(1, 1, 1), makeStop(9, 9, 2)],
        vehicles: 1, frequency: 4, operatingCost: 100,
      }],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TransportType.BUS);
    expect(result[0]!.estimatedTime).toBeGreaterThan(0);
  });

  it('returns multiple transport options from different systems', () => {
    const systems: TransitSystemInfo[] = [
      {
        type: TransportType.BUS,
        speed: 2,
        routes: [{
          id: 1, type: TransportType.BUS,
          stops: [makeStop(1, 1, 1), makeStop(9, 9, 2)],
          vehicles: 1, frequency: 4, operatingCost: 100,
        }],
      },
      {
        type: TransportType.METRO,
        speed: 3,
        routes: [{
          id: 2, type: TransportType.METRO,
          stops: [makeStop(0, 2, 3), makeStop(8, 10, 4)],
          vehicles: 1, frequency: 6, operatingCost: 300,
        }],
      },
    ];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toHaveLength(2);
    const types = result.map(r => r.type);
    expect(types).toContain(TransportType.BUS);
    expect(types).toContain(TransportType.METRO);
  });

  it('metro is faster than bus due to higher speed and euclidean distance', () => {
    // Same stops, but metro speed=3 vs bus speed=2, and metro uses euclidean (shorter)
    const stops = [makeStop(0, 0, 1), makeStop(10, 10, 2)];
    const systems: TransitSystemInfo[] = [
      {
        type: TransportType.BUS,
        speed: 2,
        routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 }],
      },
      {
        type: TransportType.METRO,
        speed: 3,
        routes: [{ id: 2, type: TransportType.METRO, stops, vehicles: 1, frequency: 6, operatingCost: 300 }],
      },
    ];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    const bus = result.find(r => r.type === TransportType.BUS)!;
    const metro = result.find(r => r.type === TransportType.METRO)!;
    expect(metro.estimatedTime).toBeLessThan(bus.estimatedTime);
  });

  it('only considers stops within walk range', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(0, 0, 1), makeStop(10, 10, 2)],
        vehicles: 1, frequency: 4, operatingCost: 100,
      }],
    }];
    const result = findAvailableTransit(systems, { x: 1, y: 1 }, { x: 5, y: 5 }, 2);
    expect(result).toHaveLength(0);
  });

  // ── Route-based distance tests ─────────────────────────────────

  it('uses segment distances when provided (bus with detour)', () => {
    // Bus route with 3 stops, segment distances show a detour
    const stops = [makeStop(0, 0, 1), makeStop(5, 0, 2), makeStop(10, 0, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 }],
      // Segment distances: stop0→stop1 = 20 (detour!), stop1→stop2 = 15, stop2→stop0 = 10
      getSegmentDistances: (routeId: number) => routeId === 1 ? [20, 15, 10] : null,
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(result).toHaveLength(1);
    // Forward: stop0→stop1→stop2 = 20+15 = 35, backward: stop2→stop0 = 10
    // Picks shorter direction: 10 / speed=2 = 5
    expect(result[0]!.estimatedTime).toBeCloseTo(5);
  });

  it('falls back to euclidean stop-to-stop distance when no segment distances', () => {
    // Metro with no segment distances — should use euclidean between stops
    const stops = [makeStop(0, 0, 1), makeStop(3, 4, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.METRO,
      speed: 3,
      routes: [{ id: 1, type: TransportType.METRO, stops, vehicles: 1, frequency: 6, operatingCost: 300 }],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 3, y: 4 }, 5);
    expect(result).toHaveLength(1);
    // Euclidean distance = 5, speed = 3 → time = 5/3
    expect(result[0]!.estimatedTime).toBeCloseTo(5 / 3);
  });

  it('handles circular route forward traversal correctly', () => {
    // Route: A(0,0) → B(5,0) → C(5,5) → back to A
    // Passenger from near C to near A should go C→A (one segment), not C→A→B→C
    const stops = [makeStop(0, 0, 1), makeStop(5, 0, 2), makeStop(5, 5, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 }],
      // seg0: A→B = 10, seg1: B→C = 8, seg2: C→A = 12
      getSegmentDistances: (routeId: number) => routeId === 1 ? [10, 8, 12] : null,
    }];
    // Origin near C (5,5), destination near A (0,0) → forward: C→A = seg2 = 12
    const result = findAvailableTransit(systems, { x: 5, y: 5 }, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(1);
    // Forward from C(idx=2) to A(idx=0): seg2 = 12, time = 12/2 = 6
    expect(result[0]!.estimatedTime).toBeCloseTo(6);
  });

  it('picks the shorter direction around circular route', () => {
    // Route: A(0,0) → B(10,0) → C(10,10) → back to A
    // seg0: A→B = 10, seg1: B→C = 10, seg2: C→A = 10
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2), makeStop(10, 10, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 }],
      getSegmentDistances: (routeId: number) => routeId === 1 ? [10, 10, 10] : null,
    }];
    // Origin near A(0,0), dest near B(10,0)
    // Forward A→B = seg0 = 10, backward A←C←B = seg2+seg1 = 20
    // Should pick forward = 10, time = 10/2 = 5
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime).toBeCloseTo(5);
  });

  it('returns 0 estimated time when origin and dest map to same stop', () => {
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 }],
      getSegmentDistances: () => [10, 10],
    }];
    // Both origin and dest are closest to stop at (0,0)
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 0, y: 1 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime).toBe(0);
  });

  it('ferry uses segment distances from water path cache', () => {
    const stops = [makeStop(0, 0, 1), makeStop(8, 8, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.FERRY,
      speed: 0.375,
      routes: [{ id: 1, type: TransportType.FERRY, stops, vehicles: 1, frequency: 4, operatingCost: 200 }],
      // Water path distance = 15 (longer than euclidean ~11.3)
      getSegmentDistances: (routeId: number) => routeId === 1 ? [15, 15] : null,
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 8, y: 8 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime).toBeCloseTo(15 / 0.375);
  });

  // ── Capacity filtering tests ──────────────────────────────────

  it('filters out routes where dailyRiders >= routeCapacity', () => {
    const stops = [makeStop(1, 1, 1), makeStop(9, 9, 2)];
    stops[0]!.dailyRiders = 100;
    stops[1]!.dailyRiders = 50;
    // 3 vehicles × capacity 50 = 150, dailyRiders = 150 → full
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS, stops, vehicles: 3,
        frequency: 4, operatingCost: 100,
      }],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toEqual([]);
  });

  it('returns route with remaining capacity', () => {
    const stops = [makeStop(1, 1, 1), makeStop(9, 9, 2)];
    stops[0]!.dailyRiders = 50;
    stops[1]!.dailyRiders = 30;
    // 3 vehicles × capacity 50 = 150, dailyRiders = 80 → has room
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS, stops, vehicles: 3,
        frequency: 4, operatingCost: 100,
      }],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TransportType.BUS);
  });

  it('adding vehicles increases route capacity (allows more riders)', () => {
    const stops = [makeStop(1, 1, 1), makeStop(9, 9, 2)];
    stops[0]!.dailyRiders = 100;
    stops[1]!.dailyRiders = 50;
    // 3 vehicles × 50 = 150 → full at 150 riders
    const sys3: TransitSystemInfo = {
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS, stops, vehicles: 3,
        frequency: 4, operatingCost: 100,
      }],
    };
    expect(findAvailableTransit([sys3], { x: 0, y: 0 }, { x: 10, y: 10 }, 5)).toEqual([]);

    // 5 vehicles × 50 = 250 → 150 < 250, has room
    const sys5: TransitSystemInfo = {
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS, stops: [...stops], vehicles: 5,
        frequency: 4, operatingCost: 100,
      }],
    };
    expect(findAvailableTransit([sys5], { x: 0, y: 0 }, { x: 10, y: 10 }, 5)).toHaveLength(1);
  });

  it('filters only full routes, keeps routes with capacity from same system', () => {
    const stopsA = [makeStop(1, 1, 1), makeStop(9, 9, 2)];
    stopsA[0]!.dailyRiders = 50;
    stopsA[1]!.dailyRiders = 50; // total 100 = full (2×50)

    const stopsB = [makeStop(2, 2, 3), makeStop(8, 8, 4)];
    stopsB[0]!.dailyRiders = 10;
    stopsB[1]!.dailyRiders = 10; // total 20 < 100 (2×50)

    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [
        { id: 1, type: TransportType.BUS, stops: stopsA, vehicles: 2, frequency: 4, operatingCost: 100 },
        { id: 2, type: TransportType.BUS, stops: stopsB, vehicles: 2, frequency: 4, operatingCost: 100 },
      ],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toHaveLength(1);
  });
});

describe('getRouteDailyRiders', () => {
  it('sums dailyRiders across all stops', () => {
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2), makeStop(10, 10, 3)];
    stops[0]!.dailyRiders = 10;
    stops[1]!.dailyRiders = 25;
    stops[2]!.dailyRiders = 15;
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 };
    expect(getRouteDailyRiders(route)).toBe(50);
  });

  it('returns 0 for route with no riders', () => {
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, frequency: 4, operatingCost: 100 };
    expect(getRouteDailyRiders(route)).toBe(0);
  });
});

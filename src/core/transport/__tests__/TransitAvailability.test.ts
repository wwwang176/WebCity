import { describe, it, expect } from 'vitest';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import { TransportType, type TransportStop } from '../types';

function makeStop(x: number, y: number): TransportStop {
  return { id: 1, x, y, type: TransportType.BUS, passengers: 0 };
}

describe('findAvailableTransit', () => {
  it('returns empty array when no transit systems exist', () => {
    const result = findAvailableTransit([], { x: 0, y: 0 }, { x: 10, y: 10 }, 5);
    expect(result).toEqual([]);
  });

  it('returns empty array when no route has stops near both origin and destination', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
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
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(1, 1), makeStop(9, 9)],
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
        routes: [{
          id: 1, type: TransportType.BUS,
          stops: [makeStop(1, 1), makeStop(9, 9)],
          vehicles: 1, frequency: 4, operatingCost: 100,
        }],
      },
      {
        type: TransportType.METRO,
        routes: [{
          id: 2, type: TransportType.METRO,
          stops: [makeStop(0, 2), makeStop(8, 10)],
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

  it('applies rail time factor for metro/rail systems', () => {
    const systems: TransitSystemInfo[] = [
      {
        type: TransportType.BUS,
        routes: [{
          id: 1, type: TransportType.BUS,
          stops: [makeStop(0, 0), makeStop(10, 10)],
          vehicles: 1, frequency: 4, operatingCost: 100,
        }],
      },
      {
        type: TransportType.METRO,
        routes: [{
          id: 2, type: TransportType.METRO,
          stops: [makeStop(0, 0), makeStop(10, 10)],
          vehicles: 1, frequency: 6, operatingCost: 300,
        }],
      },
    ];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, 0.8);
    const bus = result.find(r => r.type === TransportType.BUS)!;
    const metro = result.find(r => r.type === TransportType.METRO)!;
    // Metro should have lower estimated time due to rail factor
    expect(metro.estimatedTime).toBeLessThan(bus.estimatedTime);
  });

  it('only considers stops within walk range', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(0, 0), makeStop(10, 10)],
        vehicles: 1, frequency: 4, operatingCost: 100,
      }],
    }];
    // Walk range of 2 — stop at (0,0) is 2 away from origin (1,1), but stop at (10,10) is far from dest (5,5)
    const result = findAvailableTransit(systems, { x: 1, y: 1 }, { x: 5, y: 5 }, 2);
    expect(result).toHaveLength(0);
  });
});

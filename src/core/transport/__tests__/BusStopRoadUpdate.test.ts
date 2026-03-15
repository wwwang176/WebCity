import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import type { TransportStop } from '../types';
import type { LaneEdge } from '../../traffic/LaneGraph';
import type { TrafficSimulation, Vehicle } from '../../traffic/TrafficSimulation';

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
  return {
    from: { cellKey: `${fromX},${fromY}`, x: fromX, y: fromY, lane: 0, direction: 'E' as any },
    to: { cellKey: `${toX},${toY}`, x: toX, y: toY, lane: 0, direction: 'E' as any },
    weight: 1,
  };
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
    const stop: TransportStop = { id: 1, x: 3, y: 5, roadX: 4, roadY: 5, passengers: 0 };
    const stop2: TransportStop = { id: 2, x: 7, y: 5, roadX: 7, roadY: 6, passengers: 0 };

    // Create route manually
    const route = bus.createRoute([stop, stop2], 1);

    // Compute initial segments
    const initialEdge = makeFakeLaneEdge(4, 5, 7, 6);
    const segments = bus.computeRouteSegments(
      route,
      () => ['4,5', '7,6'],
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
      () => ['3,6', '7,6'],
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

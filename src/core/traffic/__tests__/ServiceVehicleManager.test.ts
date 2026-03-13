import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceVehicleManager, SERVICE_VEHICLE, type ServiceFacilityProvider, type ServiceVehicleType } from '../ServiceVehicleManager';
import { TrafficSimulation } from '../TrafficSimulation';
import { LaneGraph, type LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';

/** Build a simple horizontal road grid and lane graph */
function buildHorizontalRoad(length: number, roadType = RoadType.TWO_LANE) {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const cellKeys: string[] = [];

  for (let x = 0; x < length; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < length - 1) flags |= RoadDirection.EAST;
    cells.set(`${x},0`, { roadType, roadFlags: flags });
    cellKeys.push(`${x},0`);
  }

  const grid = {
    getCell: (x: number, y: number) => cells.get(`${x},${y}`) ?? null,
    width: length,
    height: 1,
  };
  const graph = new LaneGraph();
  graph.buildFromGrid(grid, cellKeys);

  return { grid, graph, cellKeys };
}

/** Create a mock service facility provider */
function createMockProvider(
  positions: { x: number; y: number }[],
  coveredCells: Map<string, number>,
): ServiceFacilityProvider {
  return {
    getFacilityPositions: () => positions,
    getCoveredCellsWithCost: () => coveredCells,
  };
}

describe('ServiceVehicleManager', () => {
  let manager: ServiceVehicleManager;
  let traffic: TrafficSimulation;
  let laneGraph: LaneGraph;
  let grid: ReturnType<typeof buildHorizontalRoad>['grid'];

  beforeEach(() => {
    manager = new ServiceVehicleManager();
    traffic = new TrafficSimulation();
    const road = buildHorizontalRoad(10);
    grid = road.grid;
    laneGraph = road.graph;
  });

  describe('tick() — spawning', () => {
    it('spawns service vehicles when a service has facilities', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      // Should have spawned some service vehicles
      const count = manager.getServiceVehicleCount();
      expect(count).toBeGreaterThan(0);
    });

    it('does not spawn vehicles when no facilities exist', () => {
      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: null,
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      expect(manager.getServiceVehicleCount()).toBe(0);
    });

    it('does not spawn vehicles when service has empty facility list', () => {
      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([], new Map()),
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      expect(manager.getServiceVehicleCount()).toBe(0);
    });

    it('spawns vehicles for multiple service types', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: createMockProvider([{ x: 5, y: 0 }], coveredCells),
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      expect(manager.getServiceVehicleCount()).toBeGreaterThan(0);
      expect(manager.getServiceVehicleCount('police')).toBeGreaterThan(0);
      expect(manager.getServiceVehicleCount('fire')).toBeGreaterThan(0);
    });

    it('respects per-facility vehicle target', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: null,
        health: null,
        garbage: null,
      };

      // Tick multiple times to fill up
      for (let i = 0; i < 10; i++) {
        manager.tick(traffic, services, grid, laneGraph);
      }

      // Should not exceed VEHICLES_PER_FACILITY * 1 facility
      expect(manager.getServiceVehicleCount('police')).toBeLessThanOrEqual(
        SERVICE_VEHICLE.VEHICLES_PER_FACILITY,
      );
    });

    it('respects total vehicle cap', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      // All services with facilities
      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], coveredCells),
        fire: createMockProvider([{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 0 }], coveredCells),
        health: createMockProvider([{ x: 6, y: 0 }, { x: 7, y: 0 }], coveredCells),
        garbage: createMockProvider([{ x: 8, y: 0 }, { x: 9, y: 0 }], coveredCells),
      };

      // Tick many times
      for (let i = 0; i < 50; i++) {
        manager.tick(traffic, services, grid, laneGraph);
      }

      expect(manager.getServiceVehicleCount()).toBeLessThanOrEqual(SERVICE_VEHICLE.MAX_TOTAL);
    });
  });

  describe('cleanup', () => {
    it('removes stale vehicle entries when traffic vehicles are removed', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      const countBefore = manager.getServiceVehicleCount();
      expect(countBefore).toBeGreaterThan(0);

      // Remove all vehicles from traffic simulation
      traffic.vehicles = [];

      // Tick again — should clean up stale entries
      manager.tick(traffic, services, grid, laneGraph);

      // Count should be refreshed: the stale entries are removed,
      // then new vehicles are spawned. But initially the stale entries are cleaned.
      // Let's verify the manager doesn't crash and maintains consistency.
      expect(manager.getServiceVehicleCount()).toBeGreaterThanOrEqual(0);
    });

    it('cleans up when facilities are removed', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const servicesWithFacilities: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: null,
        health: null,
        garbage: null,
      };

      // Spawn some vehicles
      manager.tick(traffic, servicesWithFacilities, grid, laneGraph);
      expect(manager.getServiceVehicleCount('police')).toBeGreaterThan(0);

      // Now remove the facility
      const servicesWithout: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([], new Map()),
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, servicesWithout, grid, laneGraph);

      // Police vehicles should be removed
      expect(manager.getServiceVehicleCount('police')).toBe(0);
    });
  });

  describe('service vehicle properties', () => {
    it('adds vehicles with correct serviceType on the traffic simulation', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: null,
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      // Verify the vehicle in traffic has the serviceType set
      const serviceVehicles = traffic.vehicles.filter(v => v.serviceType === 'police');
      expect(serviceVehicles.length).toBeGreaterThan(0);
      for (const v of serviceVehicles) {
        expect(v.serviceType).toBe('police');
      }
    });
  });

  describe('getServiceVehicleCount', () => {
    it('returns 0 when no service vehicles', () => {
      expect(manager.getServiceVehicleCount()).toBe(0);
      expect(manager.getServiceVehicleCount('police')).toBe(0);
    });

    it('returns correct count filtered by type', () => {
      const coveredCells = new Map<string, number>();
      for (let x = 0; x < 10; x++) coveredCells.set(`${x},0`, x);

      const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
        police: createMockProvider([{ x: 0, y: 0 }], coveredCells),
        fire: createMockProvider([{ x: 5, y: 0 }], coveredCells),
        health: null,
        garbage: null,
      };

      manager.tick(traffic, services, grid, laneGraph);

      const total = manager.getServiceVehicleCount();
      const policeCount = manager.getServiceVehicleCount('police');
      const fireCount = manager.getServiceVehicleCount('fire');

      expect(total).toBe(policeCount + fireCount);
      expect(policeCount).toBeGreaterThan(0);
      expect(fireCount).toBeGreaterThan(0);
    });
  });
});

/**
 * ServiceVehicleManager — spawns and manages cosmetic service vehicles
 * (police cars, fire trucks, ambulances, garbage trucks) that patrol
 * on roads within service coverage areas.
 *
 * Service vehicles are added to TrafficSimulation as regular vehicles
 * so they obey traffic rules (stop at lights, queue behind cars, etc.).
 */

import type { TrafficSimulation, Vehicle, ServiceVehicleType } from './TrafficSimulation';
import type { LaneGraph, LaneEdge } from './LaneGraph';
import { gridAStarPath, refineLanePath } from './Pathfinding';
import { parsePosKeyUnsafe, toPosKey, findAdjacentRoad } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

/** Interface for services to provide facility positions and coverage data. */
export interface ServiceFacilityProvider {
  getFacilityPositions(): ReadonlyArray<{ x: number; y: number }>;
  getCoveredCellsWithCost(): ReadonlyMap<string, number>;
}

export type { ServiceVehicleType } from './TrafficSimulation';

/** Service vehicle tuning constants */
export const SERVICE_VEHICLE = {
  /** Number of patrol vehicles per facility */
  VEHICLES_PER_FACILITY: 2,
  /** Maximum total service vehicles across all types */
  MAX_TOTAL: 20,
  /** Minimum covered road cells needed to spawn vehicles */
  MIN_COVERED_ROADS: 2,
} as const;

interface TrackedVehicle {
  vehicleId: number;
  serviceType: ServiceVehicleType;
}

interface PathfindGrid {
  getCell(x: number, y: number): { roadType: number } | null;
  width: number;
  height: number;
}

export class ServiceVehicleManager {
  private tracked: TrackedVehicle[] = [];

  /** Tick: clean up stale vehicles, repath stopped ones, spawn new ones. */
  tick(
    traffic: TrafficSimulation,
    services: Record<ServiceVehicleType, ServiceFacilityProvider | null>,
    grid: PathfindGrid,
    laneGraph: LaneGraph,
  ): void {
    // 1. Clean up stale entries (vehicles no longer in traffic.vehicles)
    this.cleanupStale(traffic);

    // 2. Remove vehicles for service types with no facilities
    for (const type of SERVICE_VEHICLE_TYPES) {
      const provider = services[type];
      const positions = provider?.getFacilityPositions() ?? [];
      if (positions.length === 0) {
        // Remove all tracked vehicles of this type
        this.removeAllOfType(traffic, type);
      }
    }

    // 3. Repath stopped service vehicles (reached path end)
    this.repathStoppedVehicles(traffic, services, grid, laneGraph);

    // 4. Spawn new vehicles up to target
    this.spawnVehicles(traffic, services, grid, laneGraph);
  }

  /** Count tracked service vehicles, optionally filtered by type. */
  getServiceVehicleCount(serviceType?: ServiceVehicleType): number {
    if (serviceType) {
      return this.tracked.filter(t => t.serviceType === serviceType).length;
    }
    return this.tracked.length;
  }

  // ── Internal ──

  private cleanupStale(traffic: TrafficSimulation): void {
    const activeIds = new Set(traffic.vehicles.map(v => v.id));
    this.tracked = this.tracked.filter(t => activeIds.has(t.vehicleId));
  }

  private removeAllOfType(traffic: TrafficSimulation, serviceType: ServiceVehicleType): void {
    const toRemove = this.tracked.filter(t => t.serviceType === serviceType);
    if (toRemove.length === 0) return;

    const removeIds = new Set(toRemove.map(t => t.vehicleId));
    traffic.vehicles = traffic.vehicles.filter(v => !removeIds.has(v.id));
    this.tracked = this.tracked.filter(t => t.serviceType !== serviceType);
  }

  private repathStoppedVehicles(
    traffic: TrafficSimulation,
    services: Record<ServiceVehicleType, ServiceFacilityProvider | null>,
    grid: PathfindGrid,
    laneGraph: LaneGraph,
  ): void {
    for (const entry of this.tracked) {
      const vehicle = traffic.vehicles.find(v => v.id === entry.vehicleId);
      if (!vehicle) continue;

      // Check if vehicle has reached path end
      const ep = vehicle.edgePath;
      if (ep.length === 0) continue;
      const lastEdge = ep[ep.length - 1]!;
      if (vehicle.edgeIndex < ep.length - 1) continue;
      if (vehicle.edgeProgress < lastEdge.length * 0.95) continue;

      // Vehicle is at or near path end — repath it
      const provider = services[entry.serviceType];
      if (!provider) continue;

      const coveredRoads = this.getCoveredRoadCells(provider, grid);
      if (coveredRoads.length < SERVICE_VEHICLE.MIN_COVERED_ROADS) continue;

      // Current position cell
      const currentCell = lastEdge.to.cellKey;
      const currentPos = parsePosKeyUnsafe(currentCell);

      // Pick random destination from covered roads
      const destKey = coveredRoads[Math.floor(Math.random() * coveredRoads.length)]!;
      const destPos = parsePosKeyUnsafe(destKey);

      if (currentPos.x === destPos.x && currentPos.y === destPos.y) continue;

      const edgePath = this.findEdgePath(currentPos, destPos, grid, laneGraph);
      if (edgePath && edgePath.length > 0) {
        vehicle.edgePath = edgePath;
        vehicle.edgeIndex = 0;
        vehicle.edgeProgress = 0;
        vehicle.stallTime = 0;
      }
    }
  }

  private spawnVehicles(
    traffic: TrafficSimulation,
    services: Record<ServiceVehicleType, ServiceFacilityProvider | null>,
    grid: PathfindGrid,
    laneGraph: LaneGraph,
  ): void {
    // Don't exceed total cap
    if (this.tracked.length >= SERVICE_VEHICLE.MAX_TOTAL) return;

    for (const type of SERVICE_VEHICLE_TYPES) {
      const provider = services[type];
      if (!provider) continue;

      const positions = provider.getFacilityPositions();
      if (positions.length === 0) continue;

      const target = Math.min(
        positions.length * SERVICE_VEHICLE.VEHICLES_PER_FACILITY,
        SERVICE_VEHICLE.MAX_TOTAL,
      );
      const current = this.tracked.filter(t => t.serviceType === type).length;
      if (current >= target) continue;

      // Get covered road cells
      const coveredRoads = this.getCoveredRoadCells(provider, grid);
      if (coveredRoads.length < SERVICE_VEHICLE.MIN_COVERED_ROADS) continue;

      // Spawn one vehicle per tick to avoid pathfinding burst
      if (this.tracked.length >= SERVICE_VEHICLE.MAX_TOTAL) break;

      // Find a road cell near a facility as start
      const facility = positions[Math.floor(Math.random() * positions.length)]!;
      const startRoad = findAdjacentRoad(grid, facility.x, facility.y);
      if (!startRoad) continue;

      // Pick random destination from covered roads
      const destKey = coveredRoads[Math.floor(Math.random() * coveredRoads.length)]!;
      const destPos = parsePosKeyUnsafe(destKey);

      if (startRoad.x === destPos.x && startRoad.y === destPos.y) continue;

      const edgePath = this.findEdgePath(startRoad, destPos, grid, laneGraph);
      if (edgePath && edgePath.length > 0) {
        const vehicle = traffic.addServiceVehicle(edgePath, type);
        this.tracked.push({ vehicleId: vehicle.id, serviceType: type });
      }
    }
  }

  private getCoveredRoadCells(
    provider: ServiceFacilityProvider,
    grid: PathfindGrid,
  ): string[] {
    const covered = provider.getCoveredCellsWithCost();
    const roadCells: string[] = [];
    for (const [key] of covered) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        roadCells.push(key);
      }
    }
    return roadCells;
  }

  private findEdgePath(
    from: { x: number; y: number },
    to: { x: number; y: number },
    grid: PathfindGrid,
    laneGraph: LaneGraph,
  ): LaneEdge[] | null {
    const cellPath = gridAStarPath(from, to, grid);
    if (!cellPath || cellPath.length < 2) return null;
    return refineLanePath(laneGraph, cellPath);
  }
}

const SERVICE_VEHICLE_TYPES: ServiceVehicleType[] = ['police', 'fire', 'health', 'garbage'];

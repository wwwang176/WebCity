import type { Grid } from '../grid/Grid';
import type { TrafficSimulation } from '../traffic/TrafficSimulation';
import { parsePosKeyUnsafe, findAdjacentRoad } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

export enum ServiceVehicleType {
  FIRE_TRUCK = 'FIRE_TRUCK',
  AMBULANCE = 'AMBULANCE',
  GARBAGE_TRUCK = 'GARBAGE_TRUCK',
  HEARSE = 'HEARSE',
}

/** Base travel speed in cells per tick (no congestion). */
const BASE_SPEED: Record<ServiceVehicleType, number> = {
  [ServiceVehicleType.FIRE_TRUCK]: 3,
  [ServiceVehicleType.AMBULANCE]: 3,
  [ServiceVehicleType.GARBAGE_TRUCK]: 2,
  [ServiceVehicleType.HEARSE]: 2,
};

export interface DispatchResult {
  vehicleType: ServiceVehicleType;
  path: { x: number; y: number }[];
  estimatedTicks: number;
}

/**
 * ServiceDispatch finds road-network paths for service vehicles
 * (fire truck, ambulance, garbage truck, hearse) and factors in
 * traffic congestion to estimate travel time.
 */
export class ServiceDispatch {
  private grid: Grid;
  private traffic: TrafficSimulation;
  /** Facility ID → district name. */
  private facilityDistricts = new Map<string, string>();

  constructor(grid: Grid, traffic: TrafficSimulation) {
    this.grid = grid;
    this.traffic = traffic;
  }

  /**
   * Dispatch a service vehicle from origin to destination using the road network.
   * Returns null if no path can be found.
   */
  dispatch(
    vehicleType: ServiceVehicleType,
    origin: { x: number; y: number },
    destination: { x: number; y: number },
  ): DispatchResult | null {
    const startRoad = findAdjacentRoad(this.grid, origin.x, origin.y);
    const endRoad = findAdjacentRoad(this.grid, destination.x, destination.y);
    if (!startRoad || !endRoad) return null;
    if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) {
      return { vehicleType, path: [startRoad], estimatedTicks: 1 };
    }

    const path = this.bfsRoadPath(startRoad, endRoad);
    if (!path || path.length < 2) return null;

    const congestion = this.estimateCongestion(path);
    const speed = BASE_SPEED[vehicleType];
    const travelTime = Math.ceil((path.length / speed) * (1 + congestion));

    return { vehicleType, path, estimatedTicks: travelTime };
  }

  assignFacilityToDistrict(facilityId: string, districtName: string): void {
    this.facilityDistricts.set(facilityId, districtName);
  }

  getFacilityDistrict(facilityId: string): string | undefined {
    return this.facilityDistricts.get(facilityId);
  }

  /**
   * Check whether a facility should respond to an incident in a given district.
   * Unassigned facilities respond to all districts.
   * Assigned facilities only respond to their own district.
   */
  shouldFacilityRespond(facilityId: string, incidentDistrict: string): boolean {
    const assignedDistrict = this.facilityDistricts.get(facilityId);
    if (!assignedDistrict) return true; // unassigned → respond everywhere
    return assignedDistrict === incidentDistrict;
  }


  /** BFS to find shortest road path. */
  private bfsRoadPath(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): { x: number; y: number }[] | null {
    const key = (x: number, y: number) => `${x},${y}`;
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: { x: number; y: number }[] = [start];
    visited.add(key(start.x, start.y));
    const endKey = key(end.x, end.y);

    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];

    let steps = 0;
    while (queue.length > 0 && steps < 500) {
      const cur = queue.shift()!;
      const curKey = key(cur.x, cur.y);
      steps++;

      if (curKey === endKey) {
        // Reconstruct path
        const path: { x: number; y: number }[] = [];
        let k: string | undefined = endKey;
        while (k) {
          const pos = parsePosKeyUnsafe(k);
          path.unshift(pos);
          k = parent.get(k);
        }
        return path;
      }

      for (const { dx, dy } of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nk = key(nx, ny);
        if (visited.has(nk)) continue;
        const cell = this.grid.getCell(nx, ny);
        if (!cell || cell.roadType === RoadType.NONE) continue;
        visited.add(nk);
        parent.set(nk, curKey);
        queue.push({ x: nx, y: ny });
      }
    }

    return null;
  }

  /**
   * Estimate average congestion along the path (0 = free, 1 = gridlock).
   * Uses top-congested segments from TrafficSimulation and overall vehicle
   * density as a combined heuristic.
   */
  private estimateCongestion(path: { x: number; y: number }[]): number {
    const vehicleCount = this.traffic.getVehicleCount();
    if (vehicleCount === 0) return 0;

    // Check if path overlaps with top congested segments
    const pathSet = new Set(path.map(p => `${p.x},${p.y}`));
    const topCongested = this.traffic.getTopCongested(20);
    let congestedOnPath = 0;
    let totalDensity = 0;
    for (const seg of topCongested) {
      if (pathSet.has(seg.segment)) {
        congestedOnPath++;
        totalDensity += seg.density;
      }
    }

    if (congestedOnPath > 0) {
      // Average density on congested path segments / reasonable capacity
      return Math.min(1, (totalDensity / congestedOnPath) / 4);
    }

    // Fallback: rough global congestion from total vehicles vs path capacity
    const roadCapacity = path.length * 4;
    return Math.min(1, vehicleCount / roadCapacity);
  }
}

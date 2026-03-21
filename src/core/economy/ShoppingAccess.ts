import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone, isResidentialZone } from '../grid/types';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { getBuildingType } from '../building/types';

export interface ResidentialShoppingStatus {
  /** 0~1: ratio of commercial capacity vs residential population in the connected road network. */
  ratio: number;
  /** Whether any commercial building is reachable via road. */
  hasAccess: boolean;
}

export interface CommercialCustomerStatus {
  /** 0~1: ratio of residential population vs commercial capacity in the connected road network. */
  ratio: number;
  /** Whether any residential building is reachable via road. */
  hasCustomers: boolean;
}

/**
 * ShoppingAccess determines the supply/demand relationship between residential
 * and commercial buildings within each connected road network.
 *
 * Algorithm: flood-fill BFS to identify connected components, then compute
 * component-wide ratios of commercial capacity vs residential population.
 * No distance limit — if buildings share a connected road network, they count.
 */
export class ShoppingAccess {
  /** Per residential building: component-wide ratio. */
  private residentialStatus = new Map<string, { ratio: number; hasAccess: boolean }>();
  /** Per commercial building: component-wide ratio. */
  private commercialStatus = new Map<string, { ratio: number; hasCustomers: boolean }>();
  private hasCalculated = false;

  /**
   * Single-pass flood-fill to find connected components and compute ratios.
   * Much faster than per-building BFS — visits each cell at most once.
   */
  calculate(grid: Grid): void {
    this.hasCalculated = true;
    this.residentialStatus = new Map();
    this.commercialStatus = new Map();

    const globalVisited = new Set<string>();

    grid.forEachCell((cell, x, y) => {
      // Start flood-fill from any unvisited cell that is part of the road network
      const key = toPosKey(x, y);
      if (globalVisited.has(key)) return;
      if (cell.roadType === RoadType.NONE && cell.buildingId === 0 && cell.zoneType === 0) return;

      // BFS to discover entire connected component
      const componentResidentials: string[] = [];
      const componentCommercials: string[] = [];
      let totalPopulation = 0;
      let totalCapacity = 0;

      const queue: [number, number][] = [];
      globalVisited.add(key);
      queue.push([x, y]);

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const cc = grid.getCell(cx, cy);
        if (!cc) continue;

        // Classify buildings in this component
        if (cc.buildingId > 0) {
          const ckey = toPosKey(cx, cy);
          if (isResidentialZone(cc.zoneType as ZoneType)) {
            const bt = getBuildingType(cc.buildingId);
            if (bt) {
              componentResidentials.push(ckey);
              totalPopulation += bt.residents;
            }
          } else if (isCommercialZone(cc.zoneType as ZoneType)) {
            const bt = getBuildingType(cc.buildingId);
            if (bt) {
              componentCommercials.push(ckey);
              totalCapacity += bt.workers;
            }
          }
        }

        // Expand to neighbors
        for (const [dx, dy] of FOUR_NEIGHBORS) {
          const nx = cx + dx!;
          const ny = cy + dy!;
          const nkey = toPosKey(nx, ny);
          if (globalVisited.has(nkey)) continue;
          const ncell = grid.getCell(nx, ny);
          if (!ncell) continue;
          if (ncell.roadType === RoadType.NONE && ncell.buildingId === 0 && ncell.zoneType === 0) continue;
          globalVisited.add(nkey);
          queue.push([nx, ny]);
        }
      }

      // Compute component-wide ratios
      const resRatio = totalPopulation > 0 ? Math.min(1, totalCapacity / totalPopulation) : 0;
      const comRatio = totalCapacity > 0 ? Math.min(1, totalPopulation / totalCapacity) : 0;
      const hasAccess = totalCapacity > 0;
      const hasCustomers = totalPopulation > 0;

      for (const rkey of componentResidentials) {
        this.residentialStatus.set(rkey, { ratio: resRatio, hasAccess });
      }
      for (const ckey of componentCommercials) {
        this.commercialStatus.set(ckey, { ratio: comRatio, hasCustomers });
      }
    });
  }

  /** Get shopping access status for a residential building. */
  getResidentialAccess(x: number, y: number): ResidentialShoppingStatus {
    if (!this.hasCalculated) return { ratio: 1, hasAccess: true };
    return this.residentialStatus.get(toPosKey(x, y)) ?? { ratio: 0, hasAccess: false };
  }

  /** Get customer status for a commercial building. */
  getCommercialCustomers(x: number, y: number): CommercialCustomerStatus {
    if (!this.hasCalculated) return { ratio: 1, hasCustomers: true };
    return this.commercialStatus.get(toPosKey(x, y)) ?? { ratio: 0, hasCustomers: false };
  }
}

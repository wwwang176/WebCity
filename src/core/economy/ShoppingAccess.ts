import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone, isResidentialZone } from '../grid/types';
import { toPosKey, parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { getBuildingType } from '../building/types';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

/** @deprecated Use ShoppingAccess.setRoadLookup() instead. */
export function setShoppingRoadLookup(lookup: UnifiedRoadLookup): void {
  // Backward compat — callers should migrate to instance method.
  // This no-ops since ShoppingAccess now holds its own reference.
}

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
 * Level-aware: uses UnifiedRoadLookup for compatible neighbor discovery so that
 * elevated roads only connect via ramps.
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
  /** Level-aware road lookup (DIP: injected via setRoadLookup, not module-level state). */
  private roadLookup: UnifiedRoadLookup | null = null;

  /** Set the road lookup for level-aware BFS. Call after construction. */
  setRoadLookup(lookup: UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  /**
   * Single-pass flood-fill to find connected components and compute ratios.
   * Level-aware: BFS tracks cell keys (with level) so that elevated roads
   * only relay through compatible neighbors.
   */
  calculate(grid: Grid): void {
    this.hasCalculated = true;
    this.residentialStatus.clear();
    this.commercialStatus.clear();

    // Track visited by cell key (includes level for elevated)
    const globalVisited = new Set<string>();
    // Track visited positions to avoid re-seeding
    const globalVisitedPositions = new Set<string>();

    grid.forEachCell((cell, x, y) => {
      // Start flood-fill from any unvisited cell that is part of the road network
      const posKey = toPosKey(x, y);
      if (globalVisitedPositions.has(posKey)) return;
      if (cell.roadType === RoadType.NONE && cell.buildingId === 0 && cell.zoneType === 0) {
        // Check if there's an elevated road at this position
        if (!this.roadLookup || this.roadLookup.getAllKeysAtPosition(x, y).length === 0) return;
      }

      // BFS to discover entire connected component (level-aware)
      const componentResidentials: string[] = [];
      const componentCommercials: string[] = [];
      let totalPopulation = 0;
      let totalCapacity = 0;

      // Seed with all keys at this position
      const queue: string[] = [];

      // Add ground-level seed if it's a road/building/zone
      if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || cell.zoneType !== 0) {
        if (!globalVisited.has(posKey)) {
          globalVisited.add(posKey);
          queue.push(posKey);
        }
      }

      // Add elevated road seeds at this position
      if (this.roadLookup) {
        const allKeys = this.roadLookup.getAllKeysAtPosition(x, y);
        for (const k of allKeys) {
          if (!globalVisited.has(k)) {
            globalVisited.add(k);
            queue.push(k);
          }
        }
      }

      globalVisitedPositions.add(posKey);

      while (queue.length > 0) {
        const curKey = queue.shift()!;
        const curPos = parsePosKeyUnsafe(curKey);
        const cx = curPos.x;
        const cy = curPos.y;
        const cc = grid.getCell(cx, cy);

        // Track position as visited
        globalVisitedPositions.add(toPosKey(cx, cy));

        // Classify buildings in this component (buildings are always at ground level)
        if (cc && cc.buildingId > 0) {
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

        // Expand to compatible neighbors via UnifiedRoadLookup
        for (const [dx, dy] of FOUR_NEIGHBORS) {
          const nx = cx + dx!;
          const ny = cy + dy!;

          // Road neighbors via level-aware lookup
          if (this.roadLookup) {
            const compatibleKeys = this.roadLookup.getCompatibleNeighborKeys(curKey, nx, ny);
            for (const nk of compatibleKeys) {
              if (globalVisited.has(nk)) continue;
              globalVisited.add(nk);
              queue.push(nk);
            }
          }

          // Ground-level non-road cells (buildings, zones)
          const nPosKey = toPosKey(nx, ny);
          if (!globalVisited.has(nPosKey)) {
            const ncell = grid.getCell(nx, ny);
            if (!ncell) continue;
            if (ncell.roadType !== RoadType.NONE || ncell.buildingId !== 0 || ncell.zoneType !== 0) {
              globalVisited.add(nPosKey);
              queue.push(nPosKey);
            }
          }
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

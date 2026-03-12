/**
 * Pure validation for transport stop placement (SRP: extracted from Game.ts).
 * Adding new transport types only requires adding a case here (OCP).
 */

import type { InfraType } from '../building/InfraConfig';
import { FOUR_NEIGHBORS } from '../grid/GridHelpers';

export type TransportStopType = 'bus' | 'metro' | 'rail' | 'ferry' | 'airport';

/** Map transport stop type to InfraType for cost/config lookup (OCP: add new transport types here). */
export const TRANSPORT_TO_INFRA_TYPE: Record<TransportStopType, InfraType> = {
  bus: 'bus_stop', metro: 'metro_station', rail: 'train_station',
  ferry: 'ferry_dock', airport: 'airport',
};

export type PlaceStopResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Grid interface for adjacency checks (DIP). */
export interface PlacementGrid {
  getCell(x: number, y: number): { roadType: number; buildingId: number; railType: number } | null;
}

/**
 * Validate whether a transport stop can be placed on the given cell.
 * Bus stops additionally require at least one adjacent road cell.
 * Returns ok:true or a reason code (use getBuildReasonMessage to display).
 */
export function canPlaceTransportStop(
  type: TransportStopType,
  cell: { roadType: number; buildingId: number; railType: number } | null,
  grid?: PlacementGrid,
  x?: number,
  y?: number,
): PlaceStopResult {
  if (!cell) return { ok: false, reason: 'OUT_OF_BOUNDS' };

  if (type === 'rail') {
    // Rail stations require an existing rail track; roads are OK (level crossings)
    if (cell.railType === 0) return { ok: false, reason: 'NEED_RAIL_TRACK' };
    if (cell.buildingId !== 0) return { ok: false, reason: 'TILE_OCCUPIED' };
  } else {
    if (cell.roadType !== 0 || cell.buildingId !== 0) return { ok: false, reason: 'TILE_OCCUPIED' };
  }

  // Bus stops must be adjacent to at least one road cell
  if (type === 'bus' && grid && x !== undefined && y !== undefined) {
    if (!findAdjacentRoadCell(grid, x, y)) {
      return { ok: false, reason: 'NEED_ADJACENT_ROAD' };
    }
  }

  return { ok: true };
}

/**
 * Find the first adjacent road cell (N/S/E/W) for a bus stop.
 * Returns { roadX, roadY } or null.
 */
export function findAdjacentRoadCell(
  grid: PlacementGrid,
  x: number,
  y: number,
): { roadX: number; roadY: number } | null {
  for (const [dx, dy] of FOUR_NEIGHBORS) {
    const nx = x + dx!;
    const ny = y + dy!;
    const neighbor = grid.getCell(nx, ny);
    if (neighbor && neighbor.roadType !== 0) {
      return { roadX: nx, roadY: ny };
    }
  }
  return null;
}

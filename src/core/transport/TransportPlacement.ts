/**
 * Pure validation for transport stop placement (SRP: extracted from Game.ts).
 * Adding new transport types only requires adding a case here (OCP).
 */

export type TransportStopType = 'bus' | 'metro' | 'rail' | 'ferry' | 'airport';

export type PlaceStopResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate whether a transport stop can be placed on the given cell.
 * Returns ok:true or a reason code (use getBuildReasonMessage to display).
 */
export function canPlaceTransportStop(
  type: TransportStopType,
  cell: { roadType: number; buildingId: number; railType: number } | null,
): PlaceStopResult {
  if (!cell) return { ok: false, reason: 'OUT_OF_BOUNDS' };

  if (type === 'rail') {
    // Rail stations require an existing rail track; roads are OK (level crossings)
    if (cell.railType === 0) return { ok: false, reason: 'NEED_RAIL_TRACK' };
    if (cell.buildingId !== 0) return { ok: false, reason: 'TILE_OCCUPIED' };
  } else {
    if (cell.roadType !== 0 || cell.buildingId !== 0) return { ok: false, reason: 'TILE_OCCUPIED' };
  }

  return { ok: true };
}

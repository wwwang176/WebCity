export enum RailType {
  NONE = 0,
  STANDARD = 1,
}

/** Reuse the same 4-directional bitflags as roads. */
export enum TrackDirection {
  NORTH = 0b0001,
  SOUTH = 0b0010,
  WEST  = 0b0100,
  EAST  = 0b1000,
}

export const RAIL = {
  COST_PER_CELL: 150,
} as const;

export interface BuildTrackResult {
  success: boolean;
  reason?: string;
  cost?: number;
  /** Position keys of zone buildings demolished during this operation. */
  demolishedCells?: string[];
  /**
   * Every cell the track was laid on.
   *
   * buildTrack also clears zoneType on zoned-but-EMPTY cells, which are
   * deliberately absent from demolishedCells because no building was
   * destroyed — so nothing removed their overlay instance and a coloured
   * fringe stayed along the new track until some later edit happened to call
   * rebuildZoneOverlays. Same defect as BUG-111 on roads, in the path that
   * fix did not reach.
   */
  affectedCells?: string[];
}

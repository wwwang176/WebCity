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
}

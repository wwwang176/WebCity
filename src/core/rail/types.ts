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

export const RAIL_COST = 150; // per cell

export interface BuildTrackResult {
  success: boolean;
  reason?: string;
  cost?: number;
}

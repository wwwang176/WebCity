/** Data stored for a single elevated segment (level 1-3) at a grid cell. */
export interface ElevatedSegment {
  roadType: number;
  roadFlags: number;
  railType: number;
  railFlags: number;
  /** Whether this cell is a ramp (transitioning between levels). */
  isRamp: boolean;
  /** For ramps: the cardinal direction toward the HIGHER end (N/S/E/W bit). 0 if not a ramp. */
  rampAscendDirection: number;
}

/** A position annotated with elevation info, used during path building. */
export interface ElevatedPosition {
  x: number;
  y: number;
  /** The base level of this cell (the level it occupies in ElevationManager). */
  level: number;
  /** For ramp cells, the level this ramp transitions TO. For non-ramps, equals level. */
  targetLevel: number;
  isRamp: boolean;
  rampDirection: 'up' | 'down' | null;
}

export const MIN_ELEVATION_LEVEL = 1;
export const MAX_ELEVATION_LEVEL = 3;

/** Cost multipliers for elevated construction. */
export const ELEVATION_COST = {
  /** Multiplier for elevated road/rail segments. */
  ELEVATED: 2,
  /** Multiplier for bridge segments (elevated over water). */
  BRIDGE: 3,
  /** Multiplier for ramp segments. */
  RAMP: 1.5,
  /** Maintenance multiplier for all elevated segments. */
  MAINTENANCE: 2,
} as const;

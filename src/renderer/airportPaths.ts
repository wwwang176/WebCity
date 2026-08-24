import type { AirportSize } from '../core/transport/AirportSystem';

/**
 * The airports' flight paths: **the project's only airport layout**.
 *
 * Living inside `AirplaneAnimator.ts` with `civic/models/airport.ts` drawing a second layout from
 * what an airport looks like gives two descriptions that are each reasonable but do not describe
 * the same airport: the small airport's animated runway is at z = +1.20, the front, while the
 * decorative runway band is at z in [-2.00, -0.83], the back — and the moment they meet, aircraft
 * land along the terminal's roof (BUG-239).
 *
 * **The path table is the authority.** It is tuned, tested and visibly in motion on screen, and
 * changing it is far riskier than changing a set of static decals. So the runway bands, taxiway
 * markings, gates and terminal positions are all derived from here, and `airport.ts` decides no z
 * of its own.
 *
 * Coordinates are in **cells**, with the origin at the airport plot's centre and rotation = 0.
 */

export interface Vec2 { x: number; z: number }

export interface SizeFlightPaths {
  approachStart: Vec2;
  threshold: Vec2;
  /** Roll stop: before right junction, leaving arc space. */
  rollStop: Vec2;
  /** Right taxiway junction on runway. */
  rightJunction: Vec2;
  /** Top of right taxiway at apron level. */
  rightTaxiTop: Vec2;
  /** Z level for horizontal apron taxi. */
  apronZ: number;
  /** Left taxiway top at apron level. */
  leftTaxiTop: Vec2;
  /** Left taxiway junction on runway. */
  leftJunction: Vec2;
  /** Short distance onto runway from leftJunction (for arc detection). */
  runwayEntry: Vec2;
  gates: Vec2[];
  takeoffEnd: Vec2;
  climbEnd: Vec2;
  /** Arc radius for taxiway turns. */
  arcRadius: number;
  /** Smaller arc radius for the gate approach turn. */
  gateRadius: number;
}

// SMALL (5×4): left taxi x=-1.80, right taxi x=+1.80 (old Medium layout)
export const SMALL_PATHS: SizeFlightPaths = {
  approachStart:   { x: -11.3, z: 1.20 },
  threshold:       { x: -2.00, z: 1.20 },
  rollStop:        { x: 1.30, z: 1.20 },
  rightJunction:   { x: 1.80, z: 1.20 },
  rightTaxiTop:    { x: 1.80, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -1.80, z: -0.10 },
  leftJunction:    { x: -1.80, z: 1.20 },
  runwayEntry:     { x: -1.30, z: 1.20 },
  gates:           [{ x: -0.60, z: -0.34 }, { x: 0, z: -0.34 }, { x: 0.60, z: -0.34 }],
  takeoffEnd:      { x: 2.25, z: 1.20 },
  climbEnd:        { x: 7.0, z: 1.20 },
  arcRadius:       0.35,
  gateRadius:      0.20,
};

// MEDIUM (7×4): left taxi x=-2.80, right taxi x=+2.80
export const MEDIUM_PATHS: SizeFlightPaths = {
  approachStart:   { x: -12.3, z: 1.20 },
  threshold:       { x: -3.00, z: 1.20 },
  rollStop:        { x: 2.10, z: 1.20 },
  rightJunction:   { x: 2.80, z: 1.20 },
  rightTaxiTop:    { x: 2.80, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -2.80, z: -0.10 },
  leftJunction:    { x: -2.80, z: 1.20 },
  runwayEntry:     { x: -2.10, z: 1.20 },
  gates:           [{ x: -0.90, z: -0.34 }, { x: -0.30, z: -0.34 }, { x: 0.30, z: -0.34 }, { x: 0.90, z: -0.34 }],
  takeoffEnd:      { x: 3.25, z: 1.20 },
  climbEnd:        { x: 8.0, z: 1.20 },
  arcRadius:       0.50,
  gateRadius:      0.20,
};

// LARGE (9×6): left taxi x=-3.80, right taxi x=+3.80
export const LARGE_PATH_A: SizeFlightPaths = {
  approachStart:   { x: -13.3, z: 0.80 },
  threshold:       { x: -4.00, z: 0.80 },
  rollStop:        { x: 3.10, z: 0.80 },
  rightJunction:   { x: 3.80, z: 0.80 },
  rightTaxiTop:    { x: 3.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -3.80, z: -0.80 },
  leftJunction:    { x: -3.80, z: 0.80 },
  runwayEntry:     { x: -3.10, z: 0.80 },
  gates:           [{ x: -1.50, z: -1.28 }, { x: -0.50, z: -1.28 }],
  takeoffEnd:      { x: 4.25, z: 0.80 },
  climbEnd:        { x: 9.0, z: 0.80 },
  arcRadius:       0.65,
  gateRadius:      0.43,
};

export const LARGE_PATH_B: SizeFlightPaths = {
  approachStart:   { x: -13.3, z: 2.20 },
  threshold:       { x: -4.00, z: 2.20 },
  rollStop:        { x: 3.10, z: 2.20 },
  rightJunction:   { x: 3.80, z: 2.20 },
  rightTaxiTop:    { x: 3.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -3.80, z: -0.80 },
  leftJunction:    { x: -3.80, z: 2.20 },
  runwayEntry:     { x: -3.10, z: 2.20 },
  gates:           [{ x: 0.50, z: -1.28 }, { x: 1.50, z: -1.28 }],
  takeoffEnd:      { x: 4.25, z: 2.20 },
  climbEnd:        { x: 9.0, z: 2.20 },
  arcRadius:       0.65,
  gateRadius:      0.43,
};

/** How many independent flight paths this size has. The large airport has two parallel runways. */
export const AIRPORT_PATH_COUNT: Record<AirportSize, number> = {
  SMALL: 1, MEDIUM: 1, LARGE: 2,
};

export function getFlightPaths(size: AirportSize, pathIndex: number): SizeFlightPaths {
  if (size === 'SMALL') return SMALL_PATHS;
  if (size === 'MEDIUM') return MEDIUM_PATHS;
  return pathIndex === 0 ? LARGE_PATH_A : LARGE_PATH_B;
}

/** All of this size's flight paths. */
export function allFlightPaths(size: AirportSize): SizeFlightPaths[] {
  return Array.from({ length: AIRPORT_PATH_COUNT[size] }, (_, i) => getFlightPaths(size, i));
}

// ===== Derivations the decorative geometry needs =====

/**
 * The runway centrelines' z, of which there may be two.
 *
 * Taken from `threshold.z`: on one path, `threshold`, `rollStop`, `runwayEntry` and `takeoffEnd`
 * all share a z, and that line is the runway.
 */
export function runwayCentrelines(size: AirportSize): number[] {
  return [...new Set(allFlightPaths(size).map(p => p.threshold.z))].sort((a, b) => a - b);
}

/** The two longitudinal taxiways' |x|. They are symmetric, so one value is returned. */
export function taxiwayX(size: AirportSize): number {
  return Math.abs(getFlightPaths(size, 0).rightJunction.x);
}

/** The cross taxiway's z, that is the apron connector's. */
export function apronLaneZ(size: AirportSize): number {
  return getFlightPaths(size, 0).apronZ;
}

/**
 * Every gate the flight paths use, de-duplicated and ordered left to right.
 *
 * De-duplication is necessary: two paths can share a gate, and concatenated directly it appears
 * twice, so "one jet bridge per gate" draws a second bridge on top of the first. With the large
 * airport's paths at -0.5/0.2 and 0.2/0.9, four positions are only three distinct ones.
 *
 * The two paths' gates now **do not overlap**: four independent gates, 1.0 cells = 12 m apart. At
 * three gates, 0.7 cells (8.4 m) is narrower than the 10.8 m wingspan, so two parked at once are
 * wingtip over wingtip — and the large airport's `MAX_ACTIVE` is exactly 2.
 */
export function allGates(size: AirportSize): Vec2[] {
  const seen = new Map<string, Vec2>();
  for (const p of allFlightPaths(size)) {
    for (const g of p.gates) seen.set(`${g.x},${g.z}`, g);
  }
  return [...seen.values()].sort((a, b) => a.x - b.x);
}

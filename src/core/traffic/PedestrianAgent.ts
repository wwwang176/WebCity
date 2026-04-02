/**
 * Pedestrian agent types and interfaces.
 */

import type { SidewalkEdge } from './SidewalkGraph';

export enum PedestrianTripType {
  FULL_WALK = 0,
  FIRST_MILE = 1,
  LAST_MILE = 2,
  DECORATIVE = 3,
  TRANSFER_WALK = 4,
}

export enum PedestrianState {
  WALKING = 0,
  WAITING_SIGNAL = 1,
  WAITING_CROSSING = 2,
  ARRIVED = 3,
}

export interface PedestrianAgent {
  id: number;
  citizenId: number;
  tripType: PedestrianTripType;
  edgePath: SidewalkEdge[];
  edgeIndex: number;
  edgeProgress: number;
  position: { x: number; y: number };
  heading: number;
  state: PedestrianState;
  waitTimer: number;
  colorIndex: number;
  /** Elapsed time in seconds since spawn — despawned after DESPAWN_TIMEOUT */
  age: number;
  /** Random visual offset in world X (fixed, does not rotate with heading) */
  offsetX: number;
  /** Random visual offset in world Z (fixed, does not rotate with heading) */
  offsetZ: number;
  /** Individual speed multiplier (0.5–1.0) */
  speedMultiplier: number;
}

// Re-export sidewalk types for convenience
export type { SidewalkNode, SidewalkEdge } from './SidewalkGraph';

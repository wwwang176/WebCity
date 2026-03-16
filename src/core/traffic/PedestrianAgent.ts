/**
 * Pedestrian agent types and interfaces.
 */

import type { SidewalkEdge } from './SidewalkGraph';

export enum PedestrianTripType {
  FULL_WALK = 0,
  FIRST_MILE = 1,
  LAST_MILE = 2,
  DECORATIVE = 3,
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
}

// Re-export sidewalk types for convenience
export type { SidewalkNode, SidewalkEdge } from './SidewalkGraph';

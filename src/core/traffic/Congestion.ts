/** Congestion thresholds and speed multipliers */
export const CONGESTION = {
  LOW_THRESHOLD: 0.5,
  MEDIUM_THRESHOLD: 0.8,
  HIGH_THRESHOLD: 1.0,
  MEDIUM_SPEED: 0.8,
  HIGH_SPEED: 0.5,
  MIN_SPEED: 0.05,
} as const;

export function getCongestionRate(vehicleCount: number, capacity: number): number {
  if (capacity <= 0) return 1;
  return vehicleCount / capacity;
}

export function getSpeedMultiplier(congestionRate: number): number {
  if (congestionRate <= CONGESTION.LOW_THRESHOLD) return 1;
  if (congestionRate <= CONGESTION.MEDIUM_THRESHOLD) return CONGESTION.MEDIUM_SPEED;
  if (congestionRate <= CONGESTION.HIGH_THRESHOLD) return CONGESTION.HIGH_SPEED;
  return Math.max(CONGESTION.MIN_SPEED, 1 - congestionRate);
}

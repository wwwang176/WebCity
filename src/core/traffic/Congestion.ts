export function getCongestionRate(vehicleCount: number, capacity: number): number {
  if (capacity <= 0) return 1;
  return vehicleCount / capacity;
}

export function getSpeedMultiplier(congestionRate: number): number {
  if (congestionRate <= 0.5) return 1;
  if (congestionRate <= 0.8) return 0.8;
  if (congestionRate <= 1.0) return 0.5;
  return Math.max(0.05, 1 - congestionRate);
}

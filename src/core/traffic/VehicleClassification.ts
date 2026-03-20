/** Road vehicle types for rendering classification. */
export type RoadVehicleType = 'car' | 'bus' | 'truck' | 'firetruck' | 'police_car' | 'ambulance' | 'garbage_truck';

/** Data-driven vehicle type thresholds, sorted descending by minLength (OCP-friendly). */
export const VEHICLE_TYPE_THRESHOLDS: readonly { minLength: number; type: RoadVehicleType }[] = [
  { minLength: 0.58, type: 'bus' },
  { minLength: 0.50, type: 'firetruck' },
  { minLength: 0.35, type: 'truck' },
];

const DEFAULT_VEHICLE_TYPE: RoadVehicleType = 'car';

/** Classify a road vehicle by its length. Adding new types only requires a new threshold entry. */
export function classifyVehicleType(length: number): RoadVehicleType {
  for (const entry of VEHICLE_TYPE_THRESHOLDS) {
    if (length >= entry.minLength) return entry.type;
  }
  return DEFAULT_VEHICLE_TYPE;
}

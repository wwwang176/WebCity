export interface LandValueFactors {
  serviceCoverage: number;
  parkProximity: boolean;
  waterfront: boolean;
  pollution: number;
  noise: number;
  crimeRate: number;
}

export const LAND_VALUE = {
  BASE: 50,
  SERVICE_MULTIPLIER: 4,
  PARK_BONUS: 15,
  WATERFRONT_BONUS: 20,
  POLLUTION_PENALTY: 0.5,
  NOISE_PENALTY: 0.3,
  CRIME_PENALTY: 0.4,
  MIN: 0,
  MAX: 255,
} as const;

export function calculateLandValue(factors: LandValueFactors): number {
  let value = LAND_VALUE.BASE;
  value += factors.serviceCoverage * LAND_VALUE.SERVICE_MULTIPLIER;
  if (factors.parkProximity) value += LAND_VALUE.PARK_BONUS;
  if (factors.waterfront) value += LAND_VALUE.WATERFRONT_BONUS;
  value -= factors.pollution * LAND_VALUE.POLLUTION_PENALTY;
  value -= factors.noise * LAND_VALUE.NOISE_PENALTY;
  value -= factors.crimeRate * LAND_VALUE.CRIME_PENALTY;
  return Math.max(LAND_VALUE.MIN, Math.min(LAND_VALUE.MAX, Math.round(value)));
}

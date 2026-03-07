export interface LandValueFactors {
  serviceCoverage: number;
  parkProximity: boolean;
  waterfront: boolean;
  pollution: number;
  noise: number;
  crimeRate: number;
}

export function calculateLandValue(factors: LandValueFactors): number {
  let value = 50;
  value += factors.serviceCoverage * 4;
  if (factors.parkProximity) value += 15;
  if (factors.waterfront) value += 20;
  value -= factors.pollution * 0.5;
  value -= factors.noise * 0.3;
  value -= factors.crimeRate * 0.4;
  return Math.max(0, Math.min(255, Math.round(value)));
}

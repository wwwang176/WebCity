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

/** Grid-like object that supports zero-alloc field reads. */
interface FieldReader {
  getField(x: number, y: number, field: 'terrainType' | 'buildingId'): number;
}

/**
 * Check if a cell has park proximity (park service coverage, adjacent forest,
 * or forest/park building within 2-cell Manhattan distance).
 * Uses getField() to avoid allocating CellData objects for each neighbor check.
 */
export function checkParkProximity(
  grid: FieldReader,
  x: number,
  y: number,
  hasServiceCoverage: boolean,
  parkBuildingId: number,
): boolean {
  if (hasServiceCoverage) return true;

  const FOREST = 3; // TerrainType.FOREST

  // Check 2-cell Manhattan radius (includes 1-cell cardinal neighbors)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      if (dx === 0 && dy === 0) continue;
      const terrain = grid.getField(x + dx, y + dy, 'terrainType');
      if (terrain === -1) continue; // out of bounds
      if (terrain === FOREST || grid.getField(x + dx, y + dy, 'buildingId') === parkBuildingId) return true;
    }
  }

  return false;
}

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

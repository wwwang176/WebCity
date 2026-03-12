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

const FOUR_DIRS: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * Check if a cell has park proximity (park service coverage, adjacent forest,
 * or forest/park building within 2-cell Manhattan distance).
 * Pure function extracted from SimulationLoop.updateLandValue (SRP).
 */
export function checkParkProximity(
  getCell: (x: number, y: number) => { terrainType: number; buildingId: number } | null,
  x: number,
  y: number,
  hasServiceCoverage: boolean,
  parkBuildingId: number,
): boolean {
  if (hasServiceCoverage) return true;

  const FOREST = 3; // TerrainType.FOREST

  // Check 1-cell radius (cardinal neighbors)
  for (const [dx, dy] of FOUR_DIRS) {
    const nc = getCell(x + dx, y + dy);
    if (nc && (nc.terrainType === FOREST || nc.buildingId === parkBuildingId)) return true;
  }

  // Check 2-cell Manhattan radius
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      const nc = getCell(x + dx, y + dy);
      if (nc && (nc.terrainType === FOREST || nc.buildingId === parkBuildingId)) return true;
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

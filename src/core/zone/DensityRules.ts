import { Grid } from '../grid/Grid';
import { FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType, ROAD_CONFIGS } from '../road/types';

export type DensityLevel = 'NONE' | 'LOW' | 'HIGH';

export function getMaxDensity(grid: Grid, x: number, y: number): DensityLevel {
  let bestDensity: DensityLevel = 'NONE';

  for (const [dx, dy] of FOUR_NEIGHBORS) {
    const cell = grid.getCell(x + dx, y + dy);
    if (cell && cell.roadType !== RoadType.NONE) {
      const config = ROAD_CONFIGS[cell.roadType as RoadType];
      if (config) {
        if (config.maxDensity === 'HIGH') return 'HIGH';
        if (config.maxDensity === 'LOW' && bestDensity === 'NONE') bestDensity = 'LOW';
      }
    }
  }

  return bestDensity;
}

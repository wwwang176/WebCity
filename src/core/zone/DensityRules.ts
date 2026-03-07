import { Grid } from '../grid/Grid';
import { RoadType, ROAD_CONFIGS } from '../road/types';

export type DensityLevel = 'NONE' | 'LOW' | 'HIGH';

export function getMaxDensity(grid: Grid, x: number, y: number): DensityLevel {
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];

  let bestDensity: DensityLevel = 'NONE';

  for (const d of dirs) {
    const cell = grid.getCell(x + d.dx, y + d.dy);
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

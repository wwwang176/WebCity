import { Grid } from '../grid/Grid';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { ZONE_ROAD_REACH } from '../grid/constants';

export type DensityLevel = 'NONE' | 'LOW' | 'HIGH';

/**
 * Returns the best density tier reachable from (x, y) by scanning any road
 * within Chebyshev distance `ZONE_ROAD_REACH`. Matches the reach used by
 * ZoneManager/BuildingGrowth so extended zone cells can inherit the nearest
 * road's density.
 */
export function getMaxDensity(grid: Grid, x: number, y: number): DensityLevel {
  let bestDensity: DensityLevel = 'NONE';

  for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
    for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cell = grid.getCell(x + dx, y + dy);
      if (cell && cell.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[cell.roadType as RoadType];
        if (config) {
          if (config.maxDensity === 'HIGH') return 'HIGH';
          if (config.maxDensity === 'LOW' && bestDensity === 'NONE') bestDensity = 'LOW';
        }
      }
    }
  }

  return bestDensity;
}

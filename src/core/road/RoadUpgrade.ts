import { Grid } from '../grid/Grid';
import { RoadType, ROAD_CONFIGS, type BuildRoadResult } from './types';

export class RoadUpgrade {
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  upgradeRoad(x: number, y: number, newType: RoadType, funds: number): BuildRoadResult {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) {
      return { success: false, reason: 'NO_ROAD' };
    }

    const oldConfig = ROAD_CONFIGS[cell.roadType as RoadType];
    const newConfig = ROAD_CONFIGS[newType];

    if (!oldConfig || !newConfig) {
      return { success: false, reason: 'INVALID_TYPE' };
    }

    const cost = newConfig.cost - oldConfig.cost;
    if (cost <= 0) {
      return { success: false, reason: 'CANNOT_DOWNGRADE' };
    }

    if (funds < cost) {
      return { success: false, reason: 'INSUFFICIENT_FUNDS' };
    }

    this.grid.setCell(x, y, { roadType: newType });

    return { success: true, cost, affectedCells: [`${x},${y}`] };
  }
}

import { Grid } from './Grid';
import { RoadType } from '../road/types';

/** Check if any of the 4-directional neighbors has a road */
export function isAdjacentToRoad(grid: Grid, x: number, y: number): boolean {
  return grid.getNeighbors(x, y).some(cell => cell.roadType !== RoadType.NONE);
}

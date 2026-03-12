import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { IntersectionType, TrafficControl, countRoadDirections } from './types';

export class Intersection {
  private grid: Grid;
  private controls = new Map<string, TrafficControl>();

  constructor(grid: Grid) {
    this.grid = grid;
  }

  getType(x: number, y: number): IntersectionType {
    const cell = this.grid.getCell(x, y);
    if (!cell) return IntersectionType.NONE;

    const flags = cell.roadFlags;
    const directions = countRoadDirections(flags);

    if (directions >= 4) return IntersectionType.CROSS;
    if (directions === 3) return IntersectionType.T_JUNCTION;
    return IntersectionType.NONE;
  }

  getControl(x: number, y: number): TrafficControl {
    const type = this.getType(x, y);
    if (type === IntersectionType.NONE) return TrafficControl.NONE;

    const key = toPosKey(x, y);
    return this.controls.get(key) ?? TrafficControl.TRAFFIC_LIGHT;
  }

  setControl(x: number, y: number, control: TrafficControl): void {
    this.controls.set(toPosKey(x, y), control);
  }

}

import { Grid } from '../grid/Grid';
import { RoadDirection, IntersectionType, TrafficControl } from './types';

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
    const directions = this.countDirections(flags);

    if (directions >= 4) return IntersectionType.CROSS;
    if (directions === 3) return IntersectionType.T_JUNCTION;
    return IntersectionType.NONE;
  }

  getControl(x: number, y: number): TrafficControl {
    const type = this.getType(x, y);
    if (type === IntersectionType.NONE) return TrafficControl.NONE;

    const key = `${x},${y}`;
    return this.controls.get(key) ?? TrafficControl.TRAFFIC_LIGHT;
  }

  setControl(x: number, y: number, control: TrafficControl): void {
    this.controls.set(`${x},${y}`, control);
  }

  private countDirections(flags: number): number {
    let count = 0;
    if (flags & RoadDirection.NORTH) count++;
    if (flags & RoadDirection.SOUTH) count++;
    if (flags & RoadDirection.WEST) count++;
    if (flags & RoadDirection.EAST) count++;
    return count;
  }
}

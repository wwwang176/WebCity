import { toPosKey } from '../grid/GridHelpers';

export type FlowDirection = 'N' | 'S' | 'E' | 'W' | '';

const DECAY_PER_CELL = 30;

function getDirectionOffset(direction: FlowDirection): { dx: number; dy: number } {
  switch (direction) {
    case 'N':
      return { dx: 0, dy: -1 };
    case 'S':
      return { dx: 0, dy: 1 };
    case 'E':
      return { dx: 1, dy: 0 };
    case 'W':
      return { dx: -1, dy: 0 };
    default:
      return { dx: 0, dy: 0 };
  }
}

export class WaterFlow {
  private width: number;
  private height: number;
  private flow: Map<string, FlowDirection> = new Map();
  private pollution: Map<string, number> = new Map();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private cellKey = toPosKey;

  setFlowDirection(x: number, y: number, direction: FlowDirection): void {
    this.flow.set(this.cellKey(x, y), direction);
  }

  getFlowDirection(x: number, y: number): string {
    return this.flow.get(this.cellKey(x, y)) ?? '';
  }

  spreadWaterPollution(sourceX: number, sourceY: number, amount: number): void {
    // Set pollution at source
    const sourceKey = this.cellKey(sourceX, sourceY);
    this.pollution.set(sourceKey, (this.pollution.get(sourceKey) ?? 0) + amount);

    // Follow flow direction from source
    let currentX = sourceX;
    let currentY = sourceY;
    let currentAmount = amount;

    while (currentAmount > 0) {
      const direction = this.flow.get(this.cellKey(currentX, currentY));
      if (!direction || direction.length === 0) break;

      const offset = getDirectionOffset(direction);
      const nextX = currentX + offset.dx;
      const nextY = currentY + offset.dy;

      if (nextX < 0 || nextX >= this.width || nextY < 0 || nextY >= this.height) break;

      currentAmount -= DECAY_PER_CELL;
      if (currentAmount <= 0) break;

      const nextKey = this.cellKey(nextX, nextY);
      this.pollution.set(nextKey, (this.pollution.get(nextKey) ?? 0) + currentAmount);

      currentX = nextX;
      currentY = nextY;
    }
  }

  getPollutionAt(x: number, y: number): number {
    return this.pollution.get(this.cellKey(x, y)) ?? 0;
  }
}

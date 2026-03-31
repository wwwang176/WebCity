import { describe, it, expect } from 'vitest';
import { syncTrafficDensityToGrid } from '../SyncTrafficDensity';

function makeGrid(width: number, height: number) {
  const cells: Record<string, { roadType: number; trafficDensity: number }> = {};
  return {
    width,
    height,
    forEachCell(fn: (cell: any, x: number, y: number) => void) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const key = `${x},${y}`;
          if (!cells[key]) cells[key] = { roadType: 0, trafficDensity: 0 };
          fn(cells[key], x, y);
        }
      }
    },
    setField(x: number, y: number, field: string, value: number) {
      const key = `${x},${y}`;
      if (!cells[key]) cells[key] = { roadType: 0, trafficDensity: 0 };
      (cells[key] as any)[field] = value;
    },
    getCell(x: number, y: number) {
      const key = `${x},${y}`;
      return cells[key] ?? null;
    },
    setCellRoad(x: number, y: number, roadType: number) {
      const key = `${x},${y}`;
      if (!cells[key]) cells[key] = { roadType: 0, trafficDensity: 0 };
      cells[key]!.roadType = roadType;
    },
  };
}

describe('syncTrafficDensityToGrid', () => {
  it('should write zero density when no traffic flow exists', () => {
    const grid = makeGrid(3, 3);
    grid.setCellRoad(1, 1, 1); // road cell
    const traffic = { getSegmentDensity: () => 0 };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, null, reusableMap);

    expect(grid.getCell(1, 1)!.trafficDensity).toBe(0);
  });

  it('should write log-scaled traffic density for road cells with flow', () => {
    const grid = makeGrid(3, 3);
    grid.setCellRoad(1, 0, 1);
    const traffic = {
      getSegmentDensity: (key: string) => key === '1,0' ? 8 : 0,
    };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, null, reusableMap);

    // log2(1 + 8) = log2(9) ≈ 3.17, rounded = 3
    expect(grid.getCell(1, 0)!.trafficDensity).toBe(3);
  });

  it('should cap density at 10', () => {
    const grid = makeGrid(2, 2);
    grid.setCellRoad(0, 0, 1);
    const traffic = {
      getSegmentDensity: () => 10000, // very high flow
    };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, null, reusableMap);

    expect(grid.getCell(0, 0)!.trafficDensity).toBe(10);
  });

  it('should skip non-road cells', () => {
    const grid = makeGrid(2, 2);
    // no roads set — all roadType=0
    const traffic = { getSegmentDensity: () => 50 };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, null, reusableMap);

    expect(grid.getCell(0, 0)!.trafficDensity).toBe(0);
  });

  it('should merge elevated road flow (take max) to ground cell', () => {
    const grid = makeGrid(3, 3);
    grid.setCellRoad(1, 1, 1);
    const traffic = {
      getSegmentDensity: (key: string) => {
        if (key === '1,1') return 2;       // ground flow
        if (key === '1,1,1') return 16;    // elevated flow (higher)
        return 0;
      },
    };
    const elevation = {
      toJSON: () => [
        { x: 1, y: 1, level: 1, data: { roadType: 1 } },
      ],
    };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, elevation as any, reusableMap);

    // max(2, 16) = 16, log2(1 + 16) ≈ 4.09, rounded = 4
    expect(grid.getCell(1, 1)!.trafficDensity).toBe(4);
  });

  it('should reuse the provided Map without allocation', () => {
    const grid = makeGrid(2, 2);
    grid.setCellRoad(0, 0, 1);
    const traffic = { getSegmentDensity: () => 4 };
    const reusableMap = new Map<string, number>();

    syncTrafficDensityToGrid(grid as any, traffic, null, reusableMap);
    // Map should be cleared after use (not leaked)
    expect(reusableMap.size).toBe(0);
  });
});

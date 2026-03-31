import { describe, it, expect } from 'vitest';
import { collectTradePositions, collectAdjacentRoadCells, type TradePosition } from '../FreightTradeCollector';

function makeGrid(roads: Record<string, number>) {
  return {
    getCell(x: number, y: number) {
      const key = `${x},${y}`;
      if (roads[key] !== undefined) return { roadType: roads[key], buildingId: 0 };
      return { roadType: 0, buildingId: 0 };
    },
  };
}

describe('collectAdjacentRoadCells', () => {
  it('should find road cells adjacent to a 1x1 building', () => {
    const grid = makeGrid({ '1,0': 1, '0,1': 1 }); // roads north and west
    const out: TradePosition[] = [];
    collectAdjacentRoadCells(grid, 0, 0, 50, out, null);
    expect(out.length).toBe(2);
    expect(out.every(p => p.throughput === 50)).toBe(true);
    expect(out.every(p => p.tradeKey === '0,0')).toBe(true);
  });

  it('should fallback to building origin if no adjacent road', () => {
    const grid = makeGrid({}); // no roads
    const out: TradePosition[] = [];
    collectAdjacentRoadCells(grid, 5, 5, 10, out, null);
    expect(out.length).toBe(1);
    expect(out[0]!.x).toBe(5);
    expect(out[0]!.y).toBe(5);
  });

  it('should deduplicate adjacent road cells for multi-cell buildings', () => {
    // 2x2 building at (0,0), road at (2,0) is adjacent to both (1,0) cells
    const grid = makeGrid({ '2,0': 1, '2,1': 1, '0,2': 1 });
    const out: TradePosition[] = [];
    const infraLookup = (buildingId: number) =>
      buildingId === 0 ? null : { width: 2, height: 2 };
    collectAdjacentRoadCells(
      { getCell: (x, y) => {
        const key = `${x},${y}`;
        if (x === 0 && y === 0) return { roadType: 0, buildingId: 99 };
        return grid.getCell(x, y);
      }},
      0, 0, 20, out, infraLookup,
    );
    // Should have 3 unique road cells, no duplicates
    const keys = out.map(p => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('collectTradePositions', () => {
  it('should collect positions from rail stations', () => {
    const grid = makeGrid({ '1,0': 1 }); // road adjacent to station at 0,0
    const result = collectTradePositions(grid, {
      railStations: [{ x: 0, y: 0, throughput: 50 }],
      airports: [],
      highwayCells: [],
    }, null);
    expect(result.positions.length).toBeGreaterThan(0);
    expect(result.totalThroughput).toBe(50);
  });

  it('should collect positions from airports', () => {
    const grid = makeGrid({ '1,0': 1 });
    const result = collectTradePositions(grid, {
      railStations: [],
      airports: [{ x: 0, y: 0, cargoPerTick: 30 }],
      highwayCells: [],
    }, null);
    expect(result.positions.length).toBeGreaterThan(0);
    expect(result.totalThroughput).toBe(30);
  });

  it('should collect positions from highway edge cells', () => {
    const result = collectTradePositions({ getCell: () => ({ roadType: 1, buildingId: 0 }) }, {
      railStations: [],
      airports: [],
      highwayCells: [{ x: 0, y: 0, throughput: 100 }],
    }, null);
    expect(result.positions.length).toBe(1);
    expect(result.totalThroughput).toBe(100);
  });

  it('should sum throughput from all sources', () => {
    const grid = makeGrid({ '1,0': 1, '3,0': 1 });
    const result = collectTradePositions(grid, {
      railStations: [{ x: 0, y: 0, throughput: 50 }],
      airports: [{ x: 2, y: 0, cargoPerTick: 30 }],
      highwayCells: [{ x: 5, y: 0, throughput: 20 }],
    }, null);
    expect(result.totalThroughput).toBe(100);
  });

  it('should return empty when no trade infrastructure', () => {
    const grid = makeGrid({});
    const result = collectTradePositions(grid, {
      railStations: [],
      airports: [],
      highwayCells: [],
    }, null);
    expect(result.positions.length).toBe(0);
    expect(result.totalThroughput).toBe(0);
  });
});

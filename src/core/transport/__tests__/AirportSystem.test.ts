import { describe, it, expect } from 'vitest';
import { AirportSystem, getAirportFootprint, getAirportBuildCost, AIRPORT_SIZE_CONFIG, canPlaceAirport, forEachAirportCell, placeAirportOnGrid } from '../AirportSystem';

describe('AirportSystem.findAtCell', () => {
  it('should find SMALL airport covering center cell', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 100000);
    const found = sys.findAtCell(5, 5);
    expect(found).not.toBeNull();
    expect(found!.x).toBe(5);
    expect(found!.y).toBe(5);
  });

  it('should find SMALL airport covering edge cell', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 100000);
    // SMALL footprint = 3, half = 1 → covers (4..6, 4..6)
    expect(sys.findAtCell(4, 4)).not.toBeNull();
    expect(sys.findAtCell(6, 6)).not.toBeNull();
    expect(sys.findAtCell(4, 6)).not.toBeNull();
  });

  it('should return null for cell outside airport footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 100000);
    // SMALL footprint = 3, half = 1 → (3,3) is outside
    expect(sys.findAtCell(3, 3)).toBeNull();
    expect(sys.findAtCell(7, 5)).toBeNull();
  });

  it('should return null when no airports exist', () => {
    const sys = new AirportSystem();
    expect(sys.findAtCell(5, 5)).toBeNull();
  });

  it('should find MEDIUM airport covering wider footprint', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 100000);
    // MEDIUM footprint = 5, half = 2 → covers (8..12, 8..12)
    expect(sys.findAtCell(8, 8)).not.toBeNull();
    expect(sys.findAtCell(12, 12)).not.toBeNull();
    expect(sys.findAtCell(7, 10)).toBeNull();
  });
});

describe('AirportSystem.demolishAtCell', () => {
  it('should remove airport and invoke clearCell for all footprint cells', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 100000);
    expect(sys.getAirports().length).toBe(1);

    const cleared: string[] = [];
    const result = sys.demolishAtCell(5, 5, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    // SMALL footprint=3, half=1 → 3x3=9 cells cleared
    expect(cleared.length).toBe(9);
    expect(cleared).toContain('4,4');
    expect(cleared).toContain('6,6');
  });

  it('should return false when no airport at cell', () => {
    const sys = new AirportSystem();
    const result = sys.demolishAtCell(5, 5, () => {});
    expect(result).toBe(false);
  });

  it('should handle MEDIUM airport footprint', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 100000);

    const cleared: string[] = [];
    const result = sys.demolishAtCell(10, 10, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    // MEDIUM footprint=5, half=2 → 5x5=25 cells cleared
    expect(cleared.length).toBe(25);
    expect(cleared).toContain('8,8');
    expect(cleared).toContain('12,12');
  });

  it('should find and demolish airport from any cell in footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 100000);

    // Demolish from edge cell (4,4), not center
    const cleared: string[] = [];
    const result = sys.demolishAtCell(4, 4, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    expect(cleared.length).toBe(9);
  });
});

describe('canPlaceAirport', () => {
  function makeGrid(cells: Record<string, { roadType: number; buildingId: number }>) {
    return {
      getCell: (x: number, y: number) => cells[`${x},${y}`] ?? null,
    };
  }

  it('should allow placement on all-empty cells', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    // SMALL footprint=3, half=1 → need cells (4..6, 4..6)
    for (let dy = 4; dy <= 6; dy++) {
      for (let dx = 4; dx <= 6; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    const grid = makeGrid(cells);
    expect(canPlaceAirport(grid, 5, 5, 'SMALL')).toEqual({ ok: true });
  });

  it('should reject when a cell is out of bounds', () => {
    // Only provide center cell, edges are null
    const grid = makeGrid({ '5,5': { roadType: 0, buildingId: 0 } });
    const result = canPlaceAirport(grid, 5, 5, 'SMALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AIRPORT_OUT_OF_BOUNDS');
  });

  it('should reject when a cell has a road', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    for (let dy = 4; dy <= 6; dy++) {
      for (let dx = 4; dx <= 6; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    cells['5,5'] = { roadType: 2, buildingId: 0 }; // center has road
    const grid = makeGrid(cells);
    const result = canPlaceAirport(grid, 5, 5, 'SMALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AIRPORT_AREA_OCCUPIED');
  });

  it('should reject when a cell has a building', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    for (let dy = 4; dy <= 6; dy++) {
      for (let dx = 4; dx <= 6; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    cells['4,4'] = { roadType: 0, buildingId: 5 }; // corner has building
    const grid = makeGrid(cells);
    const result = canPlaceAirport(grid, 5, 5, 'SMALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AIRPORT_AREA_OCCUPIED');
  });

  it('should check MEDIUM footprint (5x5)', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    // MEDIUM footprint=5, half=2 → need cells (8..12, 8..12)
    for (let dy = 8; dy <= 12; dy++) {
      for (let dx = 8; dx <= 12; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    const grid = makeGrid(cells);
    expect(canPlaceAirport(grid, 10, 10, 'MEDIUM')).toEqual({ ok: true });
  });
});

describe('forEachAirportCell', () => {
  it('should iterate over all cells in SMALL footprint (3x3)', () => {
    const cells: string[] = [];
    forEachAirportCell(5, 5, 'SMALL', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(9);
    expect(cells).toContain('4,4');
    expect(cells).toContain('5,5');
    expect(cells).toContain('6,6');
  });

  it('should iterate over all cells in MEDIUM footprint (5x5)', () => {
    const cells: string[] = [];
    forEachAirportCell(10, 10, 'MEDIUM', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(25);
    expect(cells).toContain('8,8');
    expect(cells).toContain('10,10');
    expect(cells).toContain('12,12');
  });

  it('should iterate over all cells in LARGE footprint (7x7)', () => {
    const cells: string[] = [];
    forEachAirportCell(20, 20, 'LARGE', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(49);
    expect(cells).toContain('17,17');
    expect(cells).toContain('20,20');
    expect(cells).toContain('23,23');
  });
});

describe('placeAirportOnGrid', () => {
  it('should set all footprint cells to the given buildingId', () => {
    const cells = new Map<string, { buildingId: number; reserved?: number }>();
    const grid = {
      setCell: (x: number, y: number, data: { buildingId: number; reserved?: number }) => {
        cells.set(`${x},${y}`, data);
      },
    };
    placeAirportOnGrid(grid, 5, 5, 'SMALL', 237);
    expect(cells.size).toBe(9);
    expect(cells.get('4,4')!.buildingId).toBe(237);
    expect(cells.get('5,5')!.buildingId).toBe(237);
    expect(cells.get('6,6')!.buildingId).toBe(237);
  });

  it('should mark center cell as primary and others as MULTI_CELL_OCCUPIED', () => {
    const cells = new Map<string, { buildingId: number; reserved?: number }>();
    const grid = {
      setCell: (x: number, y: number, data: { buildingId: number; reserved?: number }) => {
        cells.set(`${x},${y}`, data);
      },
    };
    placeAirportOnGrid(grid, 5, 5, 'SMALL', 237);
    // Center is primary (reserved=0)
    expect(cells.get('5,5')!.reserved).toBe(0);
    // All other cells are secondary (reserved=4 = MULTI_CELL_OCCUPIED)
    for (const [key, data] of cells) {
      if (key !== '5,5') {
        expect(data.reserved).toBe(4);
      }
    }
  });

  it('should handle MEDIUM footprint correctly', () => {
    const cells = new Map<string, { buildingId: number; reserved?: number }>();
    const grid = {
      setCell: (x: number, y: number, data: { buildingId: number; reserved?: number }) => {
        cells.set(`${x},${y}`, data);
      },
    };
    placeAirportOnGrid(grid, 10, 10, 'MEDIUM', 237);
    expect(cells.size).toBe(25);
    expect(cells.get('8,8')!.buildingId).toBe(237);
    expect(cells.get('12,12')!.buildingId).toBe(237);
    // Center is primary
    expect(cells.get('10,10')!.reserved).toBe(0);
    // Corner is secondary
    expect(cells.get('8,8')!.reserved).toBe(4);
  });
});

describe('getAirportBuildCost', () => {
  it('should return build cost for each size', () => {
    expect(getAirportBuildCost('SMALL')).toBe(AIRPORT_SIZE_CONFIG.SMALL.buildCost);
    expect(getAirportBuildCost('MEDIUM')).toBe(AIRPORT_SIZE_CONFIG.MEDIUM.buildCost);
    expect(getAirportBuildCost('LARGE')).toBe(AIRPORT_SIZE_CONFIG.LARGE.buildCost);
  });

  it('build costs should increase with size', () => {
    expect(getAirportBuildCost('SMALL')).toBeLessThan(getAirportBuildCost('MEDIUM'));
    expect(getAirportBuildCost('MEDIUM')).toBeLessThan(getAirportBuildCost('LARGE'));
  });
});

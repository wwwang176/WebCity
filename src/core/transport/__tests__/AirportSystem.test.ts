import { describe, it, expect } from 'vitest';
import { AirportSystem, getAirportFootprint, getAirportBuildCost, AIRPORT_SIZE_CONFIG, canPlaceAirport, forEachAirportCell, placeAirportOnGrid } from '../AirportSystem';

// SMALL=3×2, MEDIUM=5×4, LARGE=7×6  (top-left based placement)

describe('AirportSystem.findAtCell', () => {
  it('should find SMALL airport at top-left cell', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    const found = sys.findAtCell(5, 5);
    expect(found).not.toBeNull();
    expect(found!.x).toBe(5);
  });

  it('should find SMALL airport at any cell in footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    // SMALL = 3×2, top-left (5,5) → covers (5..7, 5..6)
    expect(sys.findAtCell(5, 5)).not.toBeNull();
    expect(sys.findAtCell(7, 6)).not.toBeNull();
    expect(sys.findAtCell(6, 5)).not.toBeNull();
  });

  it('should return null for cell outside airport footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    expect(sys.findAtCell(4, 4)).toBeNull();
    expect(sys.findAtCell(8, 5)).toBeNull();
    expect(sys.findAtCell(5, 7)).toBeNull();
  });

  it('should return null when no airports exist', () => {
    const sys = new AirportSystem();
    expect(sys.findAtCell(5, 5)).toBeNull();
  });

  it('should find MEDIUM airport covering wider footprint', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 0);
    // MEDIUM = 5×4, top-left (10,10) → covers (10..14, 10..13)
    expect(sys.findAtCell(10, 10)).not.toBeNull();
    expect(sys.findAtCell(14, 13)).not.toBeNull();
    expect(sys.findAtCell(9, 10)).toBeNull();
    expect(sys.findAtCell(10, 14)).toBeNull();
  });
});

describe('AirportSystem.demolishAtCell', () => {
  it('should remove airport and invoke clearCell for all footprint cells', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    expect(sys.getAirports().length).toBe(1);

    const cleared: string[] = [];
    const result = sys.demolishAtCell(5, 5, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    // SMALL = 3×2 = 6 cells
    expect(cleared.length).toBe(6);
    expect(cleared).toContain('5,5');
    expect(cleared).toContain('7,6');
  });

  it('should return false when no airport at cell', () => {
    const sys = new AirportSystem();
    const result = sys.demolishAtCell(5, 5, () => {});
    expect(result).toBe(false);
  });

  it('should handle MEDIUM airport footprint', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 0);

    const cleared: string[] = [];
    const result = sys.demolishAtCell(10, 10, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    // MEDIUM = 5×4 = 20 cells
    expect(cleared.length).toBe(20);
    expect(cleared).toContain('10,10');
    expect(cleared).toContain('14,13');
  });

  it('should find and demolish airport from any cell in footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);

    // Demolish from non-primary cell
    const cleared: string[] = [];
    const result = sys.demolishAtCell(6, 6, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    expect(cleared.length).toBe(6);
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
    // SMALL = 3×2, top-left (5,5) → need (5..7, 5..6)
    for (let dy = 5; dy <= 6; dy++) {
      for (let dx = 5; dx <= 7; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    const grid = makeGrid(cells);
    expect(canPlaceAirport(grid, 5, 5, 'SMALL')).toEqual({ ok: true });
  });

  it('should reject when a cell is out of bounds', () => {
    const grid = makeGrid({ '5,5': { roadType: 0, buildingId: 0 } });
    const result = canPlaceAirport(grid, 5, 5, 'SMALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AIRPORT_OUT_OF_BOUNDS');
  });

  it('should reject when a cell has a building', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    for (let dy = 5; dy <= 6; dy++) {
      for (let dx = 5; dx <= 7; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    cells['6,5'] = { roadType: 0, buildingId: 5 };
    const grid = makeGrid(cells);
    const result = canPlaceAirport(grid, 5, 5, 'SMALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AIRPORT_AREA_OCCUPIED');
  });

  it('should check MEDIUM footprint (5×4)', () => {
    const cells: Record<string, { roadType: number; buildingId: number }> = {};
    // MEDIUM = 5×4, top-left (10,10) → need (10..14, 10..13)
    for (let dy = 10; dy <= 13; dy++) {
      for (let dx = 10; dx <= 14; dx++) {
        cells[`${dx},${dy}`] = { roadType: 0, buildingId: 0 };
      }
    }
    const grid = makeGrid(cells);
    expect(canPlaceAirport(grid, 10, 10, 'MEDIUM')).toEqual({ ok: true });
  });
});

describe('forEachAirportCell', () => {
  it('should iterate over all cells in SMALL footprint (3×2)', () => {
    const cells: string[] = [];
    forEachAirportCell(5, 5, 'SMALL', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(6);
    expect(cells).toContain('5,5');
    expect(cells).toContain('7,6');
  });

  it('should iterate over all cells in MEDIUM footprint (5×4)', () => {
    const cells: string[] = [];
    forEachAirportCell(10, 10, 'MEDIUM', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(20);
    expect(cells).toContain('10,10');
    expect(cells).toContain('14,13');
  });

  it('should iterate over all cells in LARGE footprint (7×6)', () => {
    const cells: string[] = [];
    forEachAirportCell(20, 20, 'LARGE', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(42);
    expect(cells).toContain('20,20');
    expect(cells).toContain('26,25');
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
    expect(cells.size).toBe(6);
    expect(cells.get('5,5')!.buildingId).toBe(237);
    expect(cells.get('7,6')!.buildingId).toBe(237);
  });

  it('should mark top-left cell as primary and others as MULTI_CELL_OCCUPIED', () => {
    const cells = new Map<string, { buildingId: number; reserved?: number }>();
    const grid = {
      setCell: (x: number, y: number, data: { buildingId: number; reserved?: number }) => {
        cells.set(`${x},${y}`, data);
      },
    };
    placeAirportOnGrid(grid, 5, 5, 'SMALL', 237);
    // Top-left is primary (reserved=0)
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
    expect(cells.size).toBe(20);
    expect(cells.get('10,10')!.buildingId).toBe(237);
    expect(cells.get('14,13')!.buildingId).toBe(237);
    // Top-left is primary
    expect(cells.get('10,10')!.reserved).toBe(0);
    // Other cells are secondary
    expect(cells.get('14,13')!.reserved).toBe(4);
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

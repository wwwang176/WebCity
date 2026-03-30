import { describe, it, expect } from 'vitest';
import { AirportSystem, getAirportFootprint, getAirportBuildCost, getAirportDimensions, AIRPORT_SIZE_CONFIG, forEachAirportCell, placeAirportOnGrid } from '../AirportSystem';
import { canPlaceInfra } from '../../building/InfraPlacement';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';

// SMALL=5×4, MEDIUM=7×4, LARGE=9×6  (top-left based placement)

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
    // SMALL = 5×4, top-left (5,5) → covers (5..9, 5..8)
    expect(sys.findAtCell(5, 5)).not.toBeNull();
    expect(sys.findAtCell(9, 8)).not.toBeNull();
    expect(sys.findAtCell(7, 6)).not.toBeNull();
  });

  it('should return null for cell outside airport footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    expect(sys.findAtCell(4, 4)).toBeNull();
    expect(sys.findAtCell(10, 5)).toBeNull();
    expect(sys.findAtCell(5, 9)).toBeNull();
  });

  it('should return null when no airports exist', () => {
    const sys = new AirportSystem();
    expect(sys.findAtCell(5, 5)).toBeNull();
  });

  it('should find MEDIUM airport covering wider footprint', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 0);
    // MEDIUM = 7×4, top-left (10,10) → covers (10..16, 10..13)
    expect(sys.findAtCell(10, 10)).not.toBeNull();
    expect(sys.findAtCell(16, 13)).not.toBeNull();
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
    // SMALL = 5×4 = 20 cells
    expect(cleared.length).toBe(20);
    expect(cleared).toContain('5,5');
    expect(cleared).toContain('9,8');
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
    // MEDIUM = 7×4 = 28 cells
    expect(cleared.length).toBe(28);
    expect(cleared).toContain('10,10');
    expect(cleared).toContain('16,13');
  });

  it('should find and demolish airport from any cell in footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);

    // Demolish from non-primary cell
    const cleared: string[] = [];
    const result = sys.demolishAtCell(6, 6, (cx, cy) => cleared.push(`${cx},${cy}`));

    expect(result).toBe(true);
    expect(sys.getAirports().length).toBe(0);
    expect(cleared.length).toBe(20);
  });
});

describe('canPlaceInfra for airport (via overrideSize)', () => {
  function makeAirportGrid(size: 'SMALL' | 'MEDIUM' | 'LARGE', x: number, y: number, opts?: { railAt?: string; buildingAt?: string; noRoad?: boolean }): Grid {
    const grid = new Grid(50, 50);
    // Place adjacent road unless noRoad
    if (!opts?.noRoad) grid.setCell(x, y - 1, { roadType: RoadType.TWO_LANE });
    // Place rail if specified
    if (opts?.railAt) {
      const [rx, ry] = opts.railAt.split(',').map(Number);
      grid.setCell(rx, ry, { railType: 1 });
    }
    // Place building if specified
    if (opts?.buildingAt) {
      const [bx, by] = opts.buildingAt.split(',').map(Number);
      grid.setCell(bx, by, { buildingId: 5 });
    }
    return grid;
  }

  function airportSize(size: 'SMALL' | 'MEDIUM' | 'LARGE') {
    const d = getAirportDimensions(size);
    return { width: d.w, height: d.h };
  }

  it('should allow SMALL placement with adjacent road', () => {
    const grid = makeAirportGrid('SMALL', 5, 5);
    expect(canPlaceInfra(grid, 5, 5, 'airport_s', 0, undefined, airportSize('SMALL'))).toEqual({ ok: true });
  });

  it('should reject when cell has rail track', () => {
    const grid = makeAirportGrid('SMALL', 5, 5, { railAt: '6,5' });
    const result = canPlaceInfra(grid, 5, 5, 'airport_s', 0, undefined, airportSize('SMALL'));
    expect(result.ok).toBe(false);
  });

  it('should reject when no adjacent road', () => {
    const grid = makeAirportGrid('SMALL', 5, 5, { noRoad: true });
    const result = canPlaceInfra(grid, 5, 5, 'airport_s', 0, undefined, airportSize('SMALL'));
    expect(result.ok).toBe(false);
  });

  it('should reject out of bounds', () => {
    const grid = new Grid(5, 5);
    grid.setCell(3, 2, { roadType: RoadType.TWO_LANE });
    const result = canPlaceInfra(grid, 3, 3, 'airport_s', 0, undefined, airportSize('SMALL'));
    expect(result.ok).toBe(false);
  });

  it('should check MEDIUM footprint (7×4)', () => {
    const grid = makeAirportGrid('MEDIUM', 10, 10);
    expect(canPlaceInfra(grid, 10, 10, 'airport_m', 0, undefined, airportSize('MEDIUM'))).toEqual({ ok: true });
  });

  it('should swap dimensions when rotated 90°', () => {
    // SMALL 5×4 → rotated 90° → 4×5
    const grid = makeAirportGrid('SMALL', 5, 5);
    expect(canPlaceInfra(grid, 5, 5, 'airport_s', 90, undefined, airportSize('SMALL'))).toEqual({ ok: true });
  });
});

describe('forEachAirportCell', () => {
  it('should iterate over all cells in SMALL footprint (5×4)', () => {
    const cells: string[] = [];
    forEachAirportCell(5, 5, 'SMALL', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(20);
    expect(cells).toContain('5,5');
    expect(cells).toContain('9,8');
  });

  it('should iterate over all cells in MEDIUM footprint (7×4)', () => {
    const cells: string[] = [];
    forEachAirportCell(10, 10, 'MEDIUM', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(28);
    expect(cells).toContain('10,10');
    expect(cells).toContain('16,13');
  });

  it('should iterate over all cells in LARGE footprint (9×6)', () => {
    const cells: string[] = [];
    forEachAirportCell(20, 20, 'LARGE', (cx, cy) => cells.push(`${cx},${cy}`));
    expect(cells.length).toBe(54);
    expect(cells).toContain('20,20');
    expect(cells).toContain('28,25');
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
    expect(cells.size).toBe(20);
    expect(cells.get('5,5')!.buildingId).toBe(237);
    expect(cells.get('9,8')!.buildingId).toBe(237);
  });

  it('should mark top-left cell as primary and others as MULTI_CELL_OCCUPIED', () => {
    const cells = new Map<string, { buildingId: number; reserved?: number }>();
    const grid = {
      setCell: (x: number, y: number, data: { buildingId: number; reserved?: number }) => {
        cells.set(`${x},${y}`, data);
      },
    };
    placeAirportOnGrid(grid, 5, 5, 'SMALL', 237);
    expect(cells.size).toBe(20);
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
    expect(cells.size).toBe(28);
    expect(cells.get('10,10')!.buildingId).toBe(237);
    expect(cells.get('16,13')!.buildingId).toBe(237);
    // Top-left is primary
    expect(cells.get('10,10')!.reserved).toBe(0);
    // Other cells are secondary
    expect(cells.get('16,13')!.reserved).toBe(4);
  });
});

describe('AirportSystem.getPollutionSources multi-cell', () => {
  it('SMALL airport should emit from all 20 cells with radius', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    const sources = sys.getPollutionSources();
    expect(sources.length).toBe(20);
    for (const s of sources) {
      expect(s.type).toBe('noise');
      expect(s.amount).toBe(AIRPORT_SIZE_CONFIG.SMALL.noise);
      expect(s.radius).toBe(AIRPORT_SIZE_CONFIG.SMALL.noiseRadius);
    }
  });

  it('MEDIUM airport should emit from all 28 cells', () => {
    const sys = new AirportSystem();
    sys.build(10, 10, 'MEDIUM', 0);
    const sources = sys.getPollutionSources();
    expect(sources.length).toBe(28);
    for (const s of sources) {
      expect(s.amount).toBe(AIRPORT_SIZE_CONFIG.MEDIUM.noise);
      expect(s.radius).toBe(AIRPORT_SIZE_CONFIG.MEDIUM.noiseRadius);
    }
  });

  it('LARGE airport should emit from all 54 cells', () => {
    const sys = new AirportSystem();
    sys.build(20, 20, 'LARGE', 0);
    const sources = sys.getPollutionSources();
    expect(sources.length).toBe(54);
    for (const s of sources) {
      expect(s.amount).toBe(AIRPORT_SIZE_CONFIG.LARGE.noise);
      expect(s.radius).toBe(AIRPORT_SIZE_CONFIG.LARGE.noiseRadius);
    }
  });

  it('source coordinates should match forEachAirportCell output', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0);
    const sources = sys.getPollutionSources();
    const expected: string[] = [];
    forEachAirportCell(5, 5, 'SMALL', (cx, cy) => expected.push(`${cx},${cy}`));
    const actual = sources.map(s => `${s.x},${s.y}`);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('rotated airport should emit from rotated footprint', () => {
    const sys = new AirportSystem();
    sys.build(5, 5, 'SMALL', 0, 90); // 5×4 → 4×5
    const sources = sys.getPollutionSources();
    expect(sources.length).toBe(20);
    const expected: string[] = [];
    forEachAirportCell(5, 5, 'SMALL', (cx, cy) => expected.push(`${cx},${cy}`), 90);
    const actual = sources.map(s => `${s.x},${s.y}`);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('no airports should return empty sources', () => {
    const sys = new AirportSystem();
    expect(sys.getPollutionSources()).toEqual([]);
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

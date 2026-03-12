import { describe, it, expect } from 'vitest';
import { AirportSystem, getAirportFootprint, getAirportBuildCost, AIRPORT_SIZE_CONFIG } from '../AirportSystem';

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

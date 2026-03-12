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

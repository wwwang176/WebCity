import { describe, it, expect } from 'vitest';
import { RoadDirection, countRoadDirections } from '../types';

describe('countRoadDirections', () => {
  it('returns 0 for no flags', () => {
    expect(countRoadDirections(0)).toBe(0);
  });

  it('returns 1 for a single direction', () => {
    expect(countRoadDirections(RoadDirection.NORTH)).toBe(1);
    expect(countRoadDirections(RoadDirection.EAST)).toBe(1);
  });

  it('returns 2 for two directions', () => {
    expect(countRoadDirections(RoadDirection.NORTH | RoadDirection.SOUTH)).toBe(2);
  });

  it('returns 3 for a T-junction', () => {
    expect(countRoadDirections(RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST)).toBe(3);
  });

  it('returns 4 for a full cross', () => {
    expect(countRoadDirections(
      RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST
    )).toBe(4);
  });
});

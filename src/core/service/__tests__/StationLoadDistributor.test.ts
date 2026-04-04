import { describe, it, expect } from 'vitest';
import { distributeLoadToNearest, type LoadDemand } from '../StationLoadDistributor';

interface StubFacility { id: string; x: number; y: number; capacity: number }

describe('distributeLoadToNearest', () => {
  it('returns zero ratio with no facilities', () => {
    const result = distributeLoadToNearest([], [{ x: 5, y: 5, weight: 10 }], new Map());
    expect(result.loadRatio).toBe(0);
  });

  it('returns zero ratio with no demands', () => {
    const facs: StubFacility[] = [{ id: 'p1', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    const result = distributeLoadToNearest(facs, [], loadMap);
    expect(result.loadRatio).toBe(0);
    expect(loadMap.get('p1')).toBe(0);
  });

  it('assigns demand to nearest facility (Euclidean)', () => {
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 100 },
      { id: 'B', x: 10, y: 0, capacity: 100 },
    ];
    const demands: LoadDemand[] = [
      { x: 1, y: 0, weight: 5 },  // nearest to A
      { x: 9, y: 0, weight: 7 },  // nearest to B
    ];
    const loadMap = new Map<string, number>();
    distributeLoadToNearest(facs, demands, loadMap);

    expect(loadMap.get('A')).toBe(5);
    expect(loadMap.get('B')).toBe(7);
  });

  it('calculates load ratio as total / totalCapacity', () => {
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 50 },
      { id: 'B', x: 10, y: 0, capacity: 50 },
    ];
    const demands: LoadDemand[] = [
      { x: 0, y: 0, weight: 30 },
      { x: 10, y: 0, weight: 60 },
    ];
    const loadMap = new Map<string, number>();
    const result = distributeLoadToNearest(facs, demands, loadMap);

    // total=90, capacity=100 → ratio=0.9
    expect(result.loadRatio).toBeCloseTo(0.9);
  });

  it('returns Infinity ratio when capacity is 0 but demand exists', () => {
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 0 }];
    const demands: LoadDemand[] = [{ x: 0, y: 0, weight: 5 }];
    const loadMap = new Map<string, number>();
    const result = distributeLoadToNearest(facs, demands, loadMap);
    expect(result.loadRatio).toBe(Infinity);
  });

  it('reuses existing Map without allocation', () => {
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    loadMap.set('stale', 999);

    distributeLoadToNearest(facs, [{ x: 0, y: 0, weight: 10 }], loadMap);

    // Stale entry should be cleared
    expect(loadMap.has('stale')).toBe(false);
    expect(loadMap.get('A')).toBe(10);
  });

  it('handles equidistant facilities — picks first', () => {
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 100 },
      { id: 'B', x: 0, y: 0, capacity: 100 }, // same position
    ];
    const demands: LoadDemand[] = [{ x: 0, y: 0, weight: 10 }];
    const loadMap = new Map<string, number>();
    distributeLoadToNearest(facs, demands, loadMap);

    // Should go to first facility found
    expect(loadMap.get('A')).toBe(10);
    expect(loadMap.get('B')).toBe(0);
  });
});

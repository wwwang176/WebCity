import { describe, it, expect } from 'vitest';
import { GridCoverageArray, encodeCost, decodeCostRatio } from '../GridCoverageArray';

describe('encodeCost', () => {
  it('encodes cost=0 to 1 (nearest)', () => {
    expect(encodeCost(0, 30)).toBe(1);
  });

  it('encodes cost=budget to 255 (farthest)', () => {
    expect(encodeCost(30, 30)).toBe(255);
  });

  it('encodes cost=budget/2 to ~128', () => {
    const val = encodeCost(15, 30);
    expect(val).toBeGreaterThanOrEqual(127);
    expect(val).toBeLessThanOrEqual(129);
  });

  it('clamps below 1', () => {
    // negative cost shouldn't happen, but clamp anyway
    expect(encodeCost(-1, 30)).toBe(1);
  });

  it('clamps above 255', () => {
    expect(encodeCost(100, 30)).toBe(255);
  });
});

describe('decodeCostRatio', () => {
  it('decodes 1 to 0.0 (nearest)', () => {
    expect(decodeCostRatio(1)).toBeCloseTo(0.0);
  });

  it('decodes 255 to 1.0 (farthest)', () => {
    expect(decodeCostRatio(255)).toBeCloseTo(1.0);
  });

  it('decodes 0 to 0.0 (uncovered treated as 0)', () => {
    expect(decodeCostRatio(0)).toBeCloseTo(0.0);
  });

  it('roundtrip: encode then decode preserves ratio approximately', () => {
    const budget = 30;
    for (const cost of [0, 5, 15, 25, 30]) {
      const encoded = encodeCost(cost, budget);
      const ratio = decodeCostRatio(encoded);
      expect(ratio).toBeCloseTo(cost / budget, 1);
    }
  });
});

describe('GridCoverageArray', () => {
  it('constructor initializes all to 0', () => {
    const arr = new GridCoverageArray(4, 4);
    expect(arr.hasCoverage(0, 0)).toBe(false);
    expect(arr.getRaw(0, 0)).toBe(0);
    expect(arr.getCostRatio(0, 0)).toBe(0);
    expect(arr.getCoverageCount(0, 0)).toBe(0);
  });

  it('applyFlood writes quantized cost values', () => {
    const arr = new GridCoverageArray(4, 4);
    const flood = new Map<string, number>();
    flood.set('1,0', 0);   // cost 0
    flood.set('2,0', 15);  // cost 15
    flood.set('3,0', 30);  // cost 30 (= budget)

    arr.applyFlood(flood, 30);

    expect(arr.hasCoverage(1, 0)).toBe(true);
    expect(arr.getRaw(1, 0)).toBe(1);  // cost 0 → 1

    expect(arr.hasCoverage(2, 0)).toBe(true);
    expect(arr.getCostRatio(2, 0)).toBeCloseTo(0.5, 1);

    expect(arr.hasCoverage(3, 0)).toBe(true);
    expect(arr.getRaw(3, 0)).toBe(255);  // cost 30 → 255

    // Uncovered cell
    expect(arr.hasCoverage(0, 0)).toBe(false);
  });

  it('applyFlood increments coverage count', () => {
    const arr = new GridCoverageArray(4, 4);
    const flood1 = new Map([['1,0', 0]]);
    const flood2 = new Map([['1,0', 5]]);

    arr.applyFlood(flood1, 30);
    expect(arr.getCoverageCount(1, 0)).toBe(1);

    arr.applyFlood(flood2, 30);
    expect(arr.getCoverageCount(1, 0)).toBe(2);
  });

  it('applyFlood takes min cost when same cell covered by multiple floods', () => {
    const arr = new GridCoverageArray(4, 4);
    const flood1 = new Map([['1,0', 20]]);  // high cost
    const flood2 = new Map([['1,0', 5]]);   // low cost

    arr.applyFlood(flood1, 30);
    arr.applyFlood(flood2, 30);

    // Should keep the lower cost (flood2)
    expect(arr.getCostRatio(1, 0)).toBeCloseTo(5 / 30, 1);
  });

  it('hasCoverage returns false for out-of-bounds', () => {
    const arr = new GridCoverageArray(4, 4);
    expect(arr.hasCoverage(-1, 0)).toBe(false);
    expect(arr.hasCoverage(0, -1)).toBe(false);
    expect(arr.hasCoverage(4, 0)).toBe(false);
    expect(arr.hasCoverage(0, 4)).toBe(false);
  });

  it('getRaw returns 0 for out-of-bounds', () => {
    const arr = new GridCoverageArray(4, 4);
    expect(arr.getRaw(-1, 0)).toBe(0);
    expect(arr.getRaw(10, 10)).toBe(0);
  });

  it('getCoverageCount returns 0 for out-of-bounds', () => {
    const arr = new GridCoverageArray(4, 4);
    expect(arr.getCoverageCount(-1, 0)).toBe(0);
  });

  it('clear resets all data and counts', () => {
    const arr = new GridCoverageArray(4, 4);
    arr.applyFlood(new Map([['1,0', 0], ['2,0', 10]]), 30);
    expect(arr.hasCoverage(1, 0)).toBe(true);
    expect(arr.getCoverageCount(1, 0)).toBe(1);

    arr.clear();

    expect(arr.hasCoverage(1, 0)).toBe(false);
    expect(arr.getRaw(1, 0)).toBe(0);
    expect(arr.getCoverageCount(1, 0)).toBe(0);
  });

  it('forEachCovered iterates only covered cells', () => {
    const arr = new GridCoverageArray(4, 4);
    arr.applyFlood(new Map([['1,1', 0], ['2,1', 15]]), 30);

    const visited: { x: number; y: number; ratio: number }[] = [];
    arr.forEachCovered((x, y, ratio) => {
      visited.push({ x, y, ratio });
    });

    expect(visited.length).toBe(2);
    const cell1 = visited.find(v => v.x === 1 && v.y === 1);
    const cell2 = visited.find(v => v.x === 2 && v.y === 1);
    expect(cell1).toBeDefined();
    expect(cell1!.ratio).toBeCloseTo(0.0, 1);
    expect(cell2).toBeDefined();
    expect(cell2!.ratio).toBeCloseTo(0.5, 1);
  });

  it('applyMerged merges new flood with existing array taking min cost', () => {
    const existing = new GridCoverageArray(5, 1);
    existing.applyFlood(new Map([['1,0', 5], ['2,0', 20]]), 30);

    const merged = new GridCoverageArray(5, 1);
    const newFlood = new Map([['2,0', 3], ['3,0', 10]]);
    merged.applyMerged(newFlood, existing, 30);

    // Cell 1,0: only in existing → should have existing cost
    expect(merged.hasCoverage(1, 0)).toBe(true);
    expect(merged.getCostRatio(1, 0)).toBeCloseTo(5 / 30, 1);

    // Cell 2,0: both, newFlood has lower cost → use 3
    expect(merged.hasCoverage(2, 0)).toBe(true);
    expect(merged.getCostRatio(2, 0)).toBeCloseTo(3 / 30, 1);

    // Cell 3,0: only in newFlood
    expect(merged.hasCoverage(3, 0)).toBe(true);
    expect(merged.getCostRatio(3, 0)).toBeCloseTo(10 / 30, 1);

    // Cell 0,0: neither
    expect(merged.hasCoverage(0, 0)).toBe(false);
  });

  it('coverage count clamps at 255', () => {
    const arr = new GridCoverageArray(2, 2);
    // Apply flood 256 times to same cell
    for (let i = 0; i < 260; i++) {
      arr.applyFlood(new Map([['0,0', 0]]), 30);
    }
    expect(arr.getCoverageCount(0, 0)).toBe(255);
  });

  it('handles 0-width or 0-height gracefully', () => {
    const arr = new GridCoverageArray(0, 0);
    expect(arr.hasCoverage(0, 0)).toBe(false);
    arr.clear(); // should not throw
  });
});


describe('哪一座設施涵蓋了這一格', () => {
  /** A batch of cells all at the same cost. */
  function flood(cells: [number, number][], cost: number): Map<string, number> {
    return new Map(cells.map(([x, y]) => [`${x},${y}`, cost]));
  }

  it('should remember which facility reached the cell', () => {
    // Without this, the dots answer only how far away a facility is, not how full the one
    // serving me is.
    const arr = new GridCoverageArray(8, 8);
    arr.applyFlood(flood([[1, 1]], 0), 100, 0);
    arr.applyFlood(flood([[5, 5]], 0), 100, 1);

    expect(arr.getOwner(1, 1)).toBe(0);
    expect(arr.getOwner(5, 5)).toBe(1);
  });

  it('should hand the cell over when a closer facility arrives', () => {
    // The cheaper facility is the one serving the cell, the same rule by which data keeps the
    // minimum.
    const arr = new GridCoverageArray(8, 8);
    arr.applyFlood(flood([[3, 3]], 80), 100, 0);
    arr.applyFlood(flood([[3, 3]], 20), 100, 1);

    expect(arr.getOwner(3, 3), '比較近的那座沒有接手').toBe(1);
  });

  it('should keep the owner when a farther facility also reaches it', () => {
    const arr = new GridCoverageArray(8, 8);
    arr.applyFlood(flood([[3, 3]], 20), 100, 0);
    arr.applyFlood(flood([[3, 3]], 80), 100, 1);

    expect(arr.getOwner(3, 3), '比較遠的那座搶走了').toBe(0);
    expect(arr.getCoverageCount(3, 3), '兩座都該算進涵蓋數').toBe(2);
  });

  it('should say nobody owns an uncovered cell', () => {
    // Returning 0 would collide with facility index 0.
    expect(new GridCoverageArray(8, 8).getOwner(2, 2)).toBe(-1);
  });

  it('should say nobody owns a cell off the map', () => {
    // Without a bounds check `undefined - 1` is NaN, and NaN as an array index hands the caller
    // a facility id that does not exist or, worse, a silent undefined.
    const arr = new GridCoverageArray(8, 8);

    expect(arr.getOwner(-1, 0)).toBe(-1);
    expect(arr.getOwner(0, -1)).toBe(-1);
    expect(arr.getOwner(8, 0)).toBe(-1);
    expect(arr.getOwner(0, 8)).toBe(-1);
  });

  it('should forget the owners when cleared', () => {
    const arr = new GridCoverageArray(8, 8);
    arr.applyFlood(flood([[1, 1]], 0), 100, 3);
    arr.clear();

    expect(arr.getOwner(1, 1)).toBe(-1);
  });

  it('should carry the owners across a preview merge', () => {
    // A drag preview lays a new facility over the existing coverage. The existing cells' owners
    // must not disappear during it.
    const base = new GridCoverageArray(8, 8);
    base.applyFlood(flood([[1, 1], [2, 2]], 10), 100, 4);

    const preview = new GridCoverageArray(8, 8);
    preview.applyMerged(flood([[2, 2]], 5), base, 100, 7);

    expect(preview.getOwner(1, 1), '既有的擁有者掉了').toBe(4);
    expect(preview.getOwner(2, 2), '預覽那座比較近，該由它接手').toBe(7);
  });

  it('should refuse an owner index it cannot store', () => {
    // Owners are stored in a Uint16Array after adding 1, so 65535 is the ceiling. Silently
    // storing something else points a cell at the wrong facility, which is worse than not
    // knowing.
    const arr = new GridCoverageArray(8, 8);

    expect(() => arr.applyFlood(flood([[1, 1]], 0), 100, 65535)).toThrow();
  });
});

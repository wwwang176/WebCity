import { describe, it, expect } from 'vitest';
import {
  hashCell, STREAM, variantIndexOf, appearanceOf,
} from '../BuildingAppearance';

/**
 * Each case here pins one property of the appearance hash: determinism is what makes a reloaded save
 * look the same, stream independence rules out correlation along the diagonal, and the ranges keep
 * the existing visual tuning intact.
 */
describe('hashCell', () => {
  it('should return the same value for the same inputs', () => {
    expect(hashCell(3, 7, 0, STREAM.VARIANT)).toBe(hashCell(3, 7, 0, STREAM.VARIANT));
  });

  it('should stay inside [0, 1)', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const v = hashCell(x, y, 0, STREAM.HEIGHT);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('should not share any stream value between cells 100 apart on the diagonal', () => {
    // The failure mode this rules out: hash(x+100,y+100) at (0,0) equals hash(x,y) at (100,100), so
    // the streams of (0,0) and (100,100) share one set of numbers with the roles swapped.
    //
    // The assertion is that all stream values of both cells taken together are distinct, not that
    // every value of a differs from every value of b. The latter passes vacuously under an
    // implementation with no streams at all: every stream of a cell collapses to one value, one
    // value per cell, and two values naturally differ.
    const streams = Object.values(STREAM);
    const all = [
      ...streams.map(s => hashCell(0, 0, 0, s)),
      ...streams.map(s => hashCell(100, 100, 0, s)),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('should give a different value for each stream of the same cell', () => {
    const seen = new Set<number>();
    for (const s of Object.values(STREAM)) seen.add(hashCell(12, 34, 0, s));
    expect(seen.size).toBe(Object.values(STREAM).length);
  });

  it('should change when only seedByte changes', () => {
    expect(hashCell(5, 5, 0, STREAM.VARIANT)).not.toBe(hashCell(5, 5, 1, STREAM.VARIANT));
  });
});

describe('variantIndexOf', () => {
  it('should always land inside the variant list', () => {
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const i = variantIndexOf(x, y, 0, 8);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(8);
      }
    }
  });

  it('should use every variant roughly evenly', () => {
    const counts = new Array<number>(8).fill(0);
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) counts[variantIndexOf(x, y, 0, 8)]!++;
    }
    const expected = 10000 / 8;
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.7);
      expect(c).toBeLessThan(expected * 1.3);
    }
  });

  it('should return 0 rather than NaN when there are no variants', () => {
    expect(variantIndexOf(1, 1, 0, 0)).toBe(0);
  });
});

describe('appearanceOf', () => {
  const input = {
    x: 4, y: 9, zoneType: 2, level: 2, seedByte: 0,
    variantCount: 8, paletteSize: 8,
  };

  it('should depend on nothing but its inputs', () => {
    expect(appearanceOf(input)).toEqual(appearanceOf({ ...input }));
  });

  it('should keep scale jitter inside the ranges the look was tuned with', () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const a = appearanceOf({ ...input, x, y });
        // Width and depth are raw random values here; the registry expands the ranges per zone
        // (BUG-222).
        expect(a.width01).toBeGreaterThanOrEqual(0);
        expect(a.width01).toBeLessThan(1);
        expect(a.depth01).toBeGreaterThanOrEqual(0);
        expect(a.depth01).toBeLessThan(1);
        expect(a.heightScale).toBeGreaterThanOrEqual(0.9);
        expect(a.heightScale).toBeLessThanOrEqual(1.1);
        expect([0, 1, 2, 3]).toContain(a.rotationQuarter);
        expect(a.paletteIndex).toBeGreaterThanOrEqual(0);
        expect(a.paletteIndex).toBeLessThan(8);
      }
    }
  });

  it('should keep height jitter well under one storey', () => {
    // At +-17.5% two houses of the same level differ by a storey and read as different levels. With
    // the target height table in place the jitter is only the natural variation within one building
    // type, currently +-10%.
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const h = appearanceOf({ ...input, x, y }).heightScale;
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi / lo).toBeLessThan(1.25);
  });

  it('should produce three facade seed components, each in [0, 1)', () => {
    const a = appearanceOf(input);
    expect(a.facadeSeed).toHaveLength(3);
    for (const v of a.facadeSeed) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('should give two neighbouring cells different facade seeds', () => {
    const a = appearanceOf({ ...input, x: 10, y: 10 });
    const b = appearanceOf({ ...input, x: 11, y: 10 });
    expect(a.facadeSeed).not.toEqual(b.facadeSeed);
  });

  it('should agree with variantIndexOf', () => {
    expect(appearanceOf(input).variantIndex)
      .toBe(variantIndexOf(input.x, input.y, input.seedByte, input.variantCount));
  });
});

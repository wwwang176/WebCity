import { describe, it, expect } from 'vitest';
import { SpatialHash, type SpatialEntry } from '../SpatialHash';

function entry(vid: number, x: number, y: number, hx = 1, hy = 0, halfLen = 0.11, edgeId = 'e1', toId = 'p1'): SpatialEntry {
  return { vid, x, y, hx, hy, halfLen, halfWidth: 0.045, edgeId, toId, progressRatio: 0.5 };
}

/** Reusable scratch array shared across queries in tests. */
const out: SpatialEntry[] = [];

describe('SpatialHash', () => {
  it('returns empty for empty grid', () => {
    const sh = new SpatialHash(1.0);
    sh.queryNearbyInto(0, 0, 2.0, out);
    expect(out).toEqual([]);
  });

  it('finds inserted entry within radius', () => {
    const sh = new SpatialHash(1.0);
    const e = entry(1, 0.5, 0.5);
    sh.insert(e);
    sh.queryNearbyInto(0.5, 0.5, 1.0, out);
    expect(out).toHaveLength(1);
    expect(out[0]!.vid).toBe(1);
  });

  it('does not return entry outside radius', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 10, 10));
    sh.queryNearbyInto(0, 0, 2.0, out);
    expect(out).toHaveLength(0);
  });

  it('finds multiple entries', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 0, 0));
    sh.insert(entry(2, 0.5, 0));
    sh.insert(entry(3, 0, 0.5));
    sh.queryNearbyInto(0.25, 0.25, 1.0, out);
    expect(out).toHaveLength(3);
  });

  it('clear retains cell arrays but empties them', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 0, 0));
    sh.insert(entry(2, 1, 1));
    sh.clear();
    sh.queryNearbyInto(0, 0, 5.0, out);
    expect(out).toHaveLength(0);
  });

  it('cells are reusable after clear + re-insert', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 0.5, 0.5));
    sh.clear();
    sh.insert(entry(2, 0.5, 0.5));
    sh.queryNearbyInto(0.5, 0.5, 1.0, out);
    expect(out).toHaveLength(1);
    expect(out[0]!.vid).toBe(2);
  });

  it('handles negative coordinates', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, -2.5, -3.5));
    sh.queryNearbyInto(-2.5, -3.5, 0.5, out);
    expect(out).toHaveLength(1);
  });

  it('entries at cell boundary found from both sides', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 1.0, 0.5));
    sh.queryNearbyInto(0.9, 0.5, 0.5, out);
    expect(out.length).toBeGreaterThanOrEqual(1);
    sh.queryNearbyInto(1.1, 0.5, 0.5, out);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});

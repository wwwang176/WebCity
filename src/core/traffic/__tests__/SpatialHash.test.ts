import { describe, it, expect } from 'vitest';
import { SpatialHash, type SpatialEntry } from '../SpatialHash';

function entry(vid: number, x: number, y: number, hx = 1, hy = 0, halfLen = 0.11, edgeId = 'e1', toId = 'p1'): SpatialEntry {
  return { vid, x, y, hx, hy, halfLen, halfWidth: 0.045, edgeId, toId, progressRatio: 0.5 };
}

describe('SpatialHash', () => {
  it('returns empty for empty grid', () => {
    const sh = new SpatialHash(1.0);
    expect(sh.queryNearby(0, 0, 2.0)).toEqual([]);
  });

  it('finds inserted entry within radius', () => {
    const sh = new SpatialHash(1.0);
    const e = entry(1, 0.5, 0.5);
    sh.insert(e);
    const results = sh.queryNearby(0.5, 0.5, 1.0);
    expect(results).toHaveLength(1);
    expect(results[0]!.vid).toBe(1);
  });

  it('does not return entry outside radius', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 10, 10));
    expect(sh.queryNearby(0, 0, 2.0)).toHaveLength(0);
  });

  it('finds multiple entries', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 0, 0));
    sh.insert(entry(2, 0.5, 0));
    sh.insert(entry(3, 0, 0.5));
    const results = sh.queryNearby(0.25, 0.25, 1.0);
    expect(results).toHaveLength(3);
  });

  it('clear removes all entries', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, 0, 0));
    sh.insert(entry(2, 1, 1));
    sh.clear();
    expect(sh.queryNearby(0, 0, 5.0)).toHaveLength(0);
  });

  it('handles negative coordinates', () => {
    const sh = new SpatialHash(1.0);
    sh.insert(entry(1, -2.5, -3.5));
    const results = sh.queryNearby(-2.5, -3.5, 0.5);
    expect(results).toHaveLength(1);
  });

  it('entries at cell boundary found from both sides', () => {
    const sh = new SpatialHash(1.0);
    // Insert at cell boundary (x=1.0 exactly)
    sh.insert(entry(1, 1.0, 0.5));
    // Query from slightly left and right
    expect(sh.queryNearby(0.9, 0.5, 0.5).length).toBeGreaterThanOrEqual(1);
    expect(sh.queryNearby(1.1, 0.5, 0.5).length).toBeGreaterThanOrEqual(1);
  });
});

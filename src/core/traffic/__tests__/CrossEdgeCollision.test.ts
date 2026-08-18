import { describe, it, expect } from 'vitest';
import { SpatialHash, type SpatialEntry } from '../SpatialHash';
import { findCrossEdgeGap, CROSS_EDGE } from '../CrossEdgeCollision';

const S = CROSS_EDGE.AABB_SCALE; // 1.1
const scratch: SpatialEntry[] = [];

/** Default halfWidth=0.045 (car: width 0.09 / 2) */
function entry(
  vid: number, x: number, y: number, hx: number, hy: number,
  halfLen: number, edgeId: string, toId = 'mergePoint', progressRatio = 0.5,
  halfWidth = 0.045,
): SpatialEntry {
  return { vid, x, y, hx, hy, halfLen, halfWidth, edgeId, toId, progressRatio };
}

function buildHash(entries: SpatialEntry[]): SpatialHash<SpatialEntry> {
  const sh = new SpatialHash<SpatialEntry>(CROSS_EDGE.CELL_SIZE);
  for (const e of entries) sh.insert(e);
  return sh;
}

describe('findCrossEdgeGap', () => {
  // ── Basic filtering ──

  it('returns Infinity when no nearby vehicles', () => {
    const me = entry(1, 0, 0, 1, 0, 0.11, 'eA');
    const sh = buildHash([me]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('returns Infinity for vehicle on SAME edge', () => {
    const me = entry(5, 0, 0, 1, 0, 0.11, 'eA');
    const other = entry(2, 0.5, 0, 1, 0, 0.11, 'eA');
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('returns Infinity for vehicle on non-merging edge (different toId)', () => {
    const me = entry(5, 0, 0, 1, 0, 0.11, 'eA', 'westExit');
    const other = entry(2, 0.3, 0.05, 0, -1, 0.11, 'eB', 'eastExit');
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('returns Infinity for vehicle behind (negative forward projection)', () => {
    const me = entry(5, 1, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 0, 0, 0, 1, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('returns Infinity for vehicle far laterally (exceeds combined half-widths)', () => {
    // Combined half-widths * 1.1 = (0.045 + 0.045) * 1.1 = 0.099
    // Lateral distance = 0.15 > 0.099 → no collision
    const me = entry(5, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 0.3, 0.15, 1, 0, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('returns Infinity for vehicle beyond check radius', () => {
    const me = entry(5, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 10, 0, 0, 1, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  // ── AABB with 1.1x scaling ──

  it('uses 1.1x scaled half-lengths for forward gap', () => {
    const me = entry(1, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 0.5, 0.03, 0, -1, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    const gap = findCrossEdgeGap(me, sh, scratch);
    // forward=0.5, gap = 0.5 - (0.11 + 0.11) * 1.1 = 0.5 - 0.242 = 0.258
    expect(gap).toBeCloseTo(0.258, 2);
  });

  it('detects vehicle within combined half-widths * 1.1', () => {
    // Lateral = 0.08, threshold = (0.045 + 0.045) * 1.1 = 0.099
    // 0.08 < 0.099 → detected
    const me = entry(1, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 0.5, 0.08, 0, -1, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBeLessThan(Infinity);
  });

  it('wider vehicles have larger lateral threshold', () => {
    // Bus halfWidth = 0.0625, combined * 1.1 = (0.0625 + 0.0625) * 1.1 = 0.1375
    // Lateral = 0.12 < 0.1375 → detected
    const me = entry(1, 0, 0, 1, 0, 0.30, 'eA', 'mp1', 0.3, 0.0625);
    const other = entry(2, 0.8, 0.12, 0, -1, 0.30, 'eB', 'mp1', 0.8, 0.0625);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBeLessThan(Infinity);
  });

  // ── Progress ratio priority ──

  it('lower-ratio vehicle yields to higher-ratio vehicle', () => {
    const me = entry(1, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.3);
    const other = entry(2, 0.5, 0.03, 0, -1, 0.11, 'eB', 'mp1', 0.8);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBeLessThan(Infinity);
  });

  it('higher-ratio vehicle ignores lower-ratio vehicle', () => {
    const me = entry(2, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.8);
    const other = entry(1, 0.3, 0.03, 0, -1, 0.11, 'eB', 'mp1', 0.3);
    const sh = buildHash([me, other]);
    expect(findCrossEdgeGap(me, sh, scratch)).toBe(Infinity);
  });

  it('equal ratio: lower ID has priority', () => {
    const low = entry(1, 0.3, -0.2, 1, 0, 0.11, 'eA', 'mp1', 0.5);
    const high = entry(5, 0.3, 0.05, 0, -1, 0.11, 'eB', 'mp1', 0.5);
    const sh = buildHash([low, high]);

    expect(findCrossEdgeGap(low, sh, scratch)).toBe(Infinity);
    expect(findCrossEdgeGap(high, sh, scratch)).toBeLessThan(Infinity);
  });

  it('following vehicle (high ratio) not blocked by merging vehicle (low ratio)', () => {
    const B = entry(10, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.7);
    const C = entry(3, -0.1, 0.3, 0.5, -0.5, 0.11, 'eB', 'mp1', 0.2);
    const sh = buildHash([B, C]);
    expect(findCrossEdgeGap(B, sh, scratch)).toBe(Infinity);
  });

  it('picks closest blocking vehicle among merge siblings', () => {
    const me = entry(10, 0, 0, 1, 0, 0.11, 'eA', 'mp1', 0.2);
    const near = entry(2, 0.4, 0.03, 0, -1, 0.11, 'eB', 'mp1', 0.9);
    const far = entry(3, 1.0, 0.03, 0, -1, 0.11, 'eC', 'mp1', 0.8);
    const sh = buildHash([me, near, far]);
    const gap = findCrossEdgeGap(me, sh, scratch);
    // nearest: forward=0.4, gap = 0.4 - (0.11+0.11)*1.1 = 0.4 - 0.242 = 0.158
    expect(gap).toBeCloseTo(0.158, 2);
  });
});

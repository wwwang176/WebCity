import { describe, it, expect } from 'vitest';
import { districtOutline } from '../DistrictOutline';

/**
 * The selected district has to be visible on the map.
 *
 * An outline rather than a highlight: the district overlay already tints those cells, and a
 * translucent white on top makes the area look faded rather than selected.
 *
 * Coordinates: cell centres are on integers, matching buildings and the cursor, so boundaries
 * fall on .5. The outline and the overlay's tiles have to cut on the same line, and half a cell
 * out leaves the tiles poking past the edge.
 */

const key = (x: number, y: number) => `${x},${y}`;
const rect = (x1: number, y1: number, x2: number, y2: number) => {
  const s = new Set<string>();
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) s.add(key(x, y));
  return s;
};

/** A normalised string for a segment, so which endpoint comes first does not affect the
 *  comparison. */
const norm = (s: { x1: number; y1: number; x2: number; y2: number }) => {
  const a = `${s.x1},${s.y1}`, b = `${s.x2},${s.y2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};
const outlineOf = (cells: Set<string>) => districtOutline(cells).map(norm).sort();

describe('分區外框', () => {
  it('should draw a unit square around a single cell', () => {
    expect(outlineOf(rect(0, 0, 0, 0))).toEqual([
      '-0.5,-0.5|-0.5,0.5',   // west
      '-0.5,-0.5|0.5,-0.5',   // north
      '-0.5,0.5|0.5,0.5',     // south
      '0.5,-0.5|0.5,0.5',     // east
    ].sort());
  });

  it('should not draw the seam between two neighbours', () => {
    // Two cells side by side outline in 6 segments, not 8: the line between them appears once
    // from each side and both have to cancel.
    const segs = outlineOf(rect(0, 0, 1, 0));
    expect(segs.length, '中間的接縫沒有消掉').toBe(6);
    expect(segs).not.toContain('0.5,-0.5|0.5,0.5');
  });

  it('should trace a hole in the middle', () => {
    // A hole carved by subtract mode is a boundary too. Without it, the hollowed middle still
    // looks selected.
    const cells = rect(0, 0, 2, 2);
    cells.delete(key(1, 1));
    const segs = outlineOf(cells);
    expect(segs.length, '外圈 12 段 + 洞 4 段').toBe(16);
    expect(segs, '洞的北邊沒有畫').toContain('0.5,0.5|1.5,0.5');
  });

  it('should outline each piece of a split district', () => {
    // A district need not be connected: subtract can cut one into two.
    const cells = new Set([...rect(0, 0, 0, 0), ...rect(5, 5, 5, 5)]);
    expect(outlineOf(cells).length).toBe(8);
  });

  it('should produce nothing for an empty district', () => {
    expect(districtOutline(new Set())).toEqual([]);
  });

  it('should ignore duplicated work on a big block', () => {
    // A 5x5 outlines in 20 segments; the interior's 4x5 + 5x4 = 40 seams all have to cancel.
    expect(outlineOf(rect(0, 0, 4, 4)).length).toBe(20);
  });
});

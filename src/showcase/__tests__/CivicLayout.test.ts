import { describe, it, expect } from 'vitest';
import {
  civicLayout, civicLayoutExtent, CIVIC_LAYOUT_GAP, CIVIC_LAYOUT_ROW_LIMIT,
} from '../civicLayout';
import { civicTypesDone } from '../../renderer/geometry/civic/registry';
import { getInfraConfig, type InfraType } from '../../core/building/InfraConfig';

/**
 * The showcase lays **every** civic building out at once.
 *
 * Switching through them one at a time is not merely tedious: the **relationships** among the
 * nineteen — whether the colours separate, whether the height differences are reasonable, whether
 * the street furniture's density is consistent — are visible only side by side, and they are exactly
 * what needs reviewing.
 */

/**
 * A list mixing sizes and spanning several rows.
 *
 * **Not** `civicTypesDone()`: that table is filled in batches and began with a single building, and
 * "no two overlap" and "rows are separated" say nothing about one entry. Changing the wrap's
 * `rowZ += rowDepth + GAP` to `rowZ += GAP`, stacking the rows straight on top of each other, left
 * every test green.
 *
 * The depths are deliberately uneven (6 / 3 / 1 / 4 ...): the deepest building in a row decides
 * where the next row starts, which a list of uniform 2x2 entries cannot test.
 */
const MIXED: InfraType[] = [
  'airport_l', 'airport_l', 'police', 'hospital', 'bus_stop',
  'school_univ', 'airport_m', 'park', 'fire', 'school_high',
  'water', 'ferry_dock', 'cemetery',
];

const foot = (t: InfraType) => {
  const c = getInfraConfig(t)!;
  return { w: c.width, h: c.height };
};

/** The rectangle one building occupies, in cells. */
function rect(slot: { type: InfraType; x: number; z: number }) {
  const f = foot(slot.type);
  return {
    x0: slot.x - f.w / 2, x1: slot.x + f.w / 2,
    z0: slot.z - f.h / 2, z1: slot.z + f.h / 2,
  };
}

/** The smallest clearance between any pair; negative is the amount of overlap. */
function closestPair(types: InfraType[]): { gap: number; who: string } {
  const slots = civicLayout(types);
  let gap = Infinity;
  let who = '（沒有兩棟以上）';
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = rect(slots[i]!), b = rect(slots[j]!);
      // The larger of the two axes: two rectangles are separated as soon as one axis separates
      // them.
      const d = Math.max(
        Math.max(a.x0 - b.x1, b.x0 - a.x1),
        Math.max(a.z0 - b.z1, b.z0 - a.z1),
      );
      if (d < gap) {
        gap = d;
        who = `${slots[i]!.type} 與 ${slots[j]!.type}`;
      }
    }
  }
  return { gap, who };
}

describe.each([
  ['實際已完成的種類', () => civicTypesDone()],
  ['混合尺寸的合成清單', () => MIXED],
])('公共建築的排版（%s）', (_label, listOf) => {
  it('should place every type exactly once, in the order given', () => {
    // One missing shows only as the building someone just made not appearing, which looks exactly
    // like not having made it.
    expect(civicLayout(listOf()).map(s => s.type)).toEqual(listOf());
  });

  it('should never let two buildings overlap', () => {
    // The layout's one real correctness condition. Two overlapping buildings interpenetrate with no
    // error at all, and it reads as one of them being drawn wrong.
    const { gap, who } = closestPair(listOf());
    expect(gap, `${who} 重疊`).toBeGreaterThan(0);
  });

  it('should keep a walkable gap between neighbours', () => {
    // Testing only for no overlap, a gap of 0 would pass — and nineteen buildings touching form one
    // mass with no boundaries, where no plot can be told from the next.
    const { gap, who } = closestPair(listOf());
    expect(gap, `${who} 之間沒有留白`).toBeGreaterThanOrEqual(CIVIC_LAYOUT_GAP - 1e-9);
  });

  it('should wrap into rows instead of one endless line', () => {
    // Nineteen in one row run past 60 cells = 720 m, and the camera has to pull back beyond any
    // visible detail to fit them.
    const rs = civicLayout(listOf()).map(rect);
    const width = Math.max(...rs.map(r => r.x1)) - Math.min(...rs.map(r => r.x0));
    expect(width).toBeLessThanOrEqual(CIVIC_LAYOUT_ROW_LIMIT + 1e-9);
  });

  it('should centre the whole layout on the origin', () => {
    // The showcase's camera points at the origin by default. With the whole set off in the positive
    // quadrant it opens on empty ground, which the matrix mode hit.
    const rs = civicLayout(listOf()).map(rect);
    const cx = (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2;
    const cz = (Math.min(...rs.map(r => r.z0)) + Math.max(...rs.map(r => r.z1))) / 2;
    expect(cx).toBeCloseTo(0, 6);
    expect(cz).toBeCloseTo(0, 6);
  });
});

describe('公共建築的排版', () => {
  it('should start a new row when the next building would not fit', () => {
    // Two large airports side by side are 9 + 2 + 9 = 20 cells, past the limit: they wrap rather
    // than being forced out.
    const slots = civicLayout(['airport_l', 'airport_l']);
    expect(slots[0]!.z, '第二棟沒有換行').not.toBeCloseTo(slots[1]!.z, 6);
  });

  it('should keep the batch order so related buildings stand together', () => {
    // The order comes from `civicTypesDone()`, which is `CIVIC_MODELS`' declaration order and groups
    // related kinds together. Sorted by size, the police and fire stations are not adjacent, and
    // whether their blue and red separate is exactly what side-by-side placement shows.
    const asked: InfraType[] = ['park', 'airport_l', 'police'];
    expect(civicLayout(asked).map(s => s.type)).toEqual(asked);
  });

  it('should return nothing for an empty list', () => {
    expect(civicLayout([])).toEqual([]);
    expect(civicLayoutExtent([])).toEqual({ w: 0, h: 0 });
  });

  it('should measure the extent including the footprints, not just the centres', () => {
    // Measured on centres alone, half of the outermost building falls off screen — and this number
    // is what the camera is framed by.
    const slots = civicLayout(['airport_l']);
    expect(civicLayoutExtent(slots)).toEqual({ w: 9, h: 6 });
  });

  it('should cover every building in the extent it reports', () => {
    const slots = civicLayout(MIXED);
    const ext = civicLayoutExtent(slots);
    for (const s of slots) {
      const r = rect(s);
      expect(Math.max(Math.abs(r.x0), Math.abs(r.x1)), `${s.type} 落在回報的範圍外`)
        .toBeLessThanOrEqual(ext.w / 2 + 1e-9);
      expect(Math.max(Math.abs(r.z0), Math.abs(r.z1)), `${s.type} 落在回報的範圍外`)
        .toBeLessThanOrEqual(ext.h / 2 + 1e-9);
    }
  });
});

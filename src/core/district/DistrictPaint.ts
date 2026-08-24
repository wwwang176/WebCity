import type { DistrictManager } from './DistrictManager';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/**
 * The district brush's three modes.
 *
 * Replace exists because district boundaries are often redrawn: without it the player has to
 * erase the whole district first, and erasing itself is a cell-by-cell drag.
 */
export type DistrictPaintMode = 'replace' | 'add' | 'subtract';

/**
 * What one brush stroke actually changed.
 *
 * The caller reports it. Taking cells is correct — a cell belongs to one district — but doing it
 * silently is not: a stroke over another district transfers two dozen cells with nothing but a
 * quiet colour change on screen. Subtracting over another district does nothing at all, and that
 * silent no-op is the hardest thing about this brush to understand.
 */
export interface DistrictPaintResult {
  /** How many cells this district gained. Cells it already had do not count. */
  added: number;
  /** How many cells this district lost. */
  removed: number;
  /**
   * Cells in the rectangle belonging to other districts, as district id to count.
   *
   * Under add and replace these were taken; under subtract they were touched but left alone. The
   * same data, with the caller phrasing it by mode.
   */
  fromOthers: Map<string, number>;
}

/** What one mouse action does: pick a district up, put it down, or paint. */
export type DistrictGesture =
  | { kind: 'select'; districtId: string }
  | { kind: 'deselect' }
  | { kind: 'paint' };

/**
 * On one brush, a click and a drag are different actions.
 *
 * Without click-to-select, changing which district is being edited has only one route: opening
 * the policy panel and picking from the sidebar — while the district is right there on the map.
 * District colours and names are drawn on the overlay, and clicking one is the obvious action.
 *
 * Clicking your own district releases the selection (pick it up, adjust it, click again to put it
 * down) — **except in subtract mode**, where clicking your own cell with an eraser unambiguously
 * means erasing that cell, and no other gesture erases a single cell. In add mode clicking your
 * own cell changes nothing anyway, and in replace mode it would shrink the district to one cell;
 * neither is what the click was for.
 *
 * A drag is always paint, even starting on another district or on your own: a large drag that
 * only toggled a selection reads as a broken brush.
 */
export function resolveDistrictGesture(
  districts: Pick<DistrictManager, 'getDistrictAt'>,
  activeDistrictId: string | null,
  x1: number, y1: number, x2: number, y2: number,
  mode: DistrictPaintMode,
): DistrictGesture {
  if (x1 !== x2 || y1 !== y2) return { kind: 'paint' };
  const under = districts.getDistrictAt(x1, y1);
  if (!under) return { kind: 'paint' };
  if (under.id !== activeDistrictId) return { kind: 'select', districtId: under.id };
  return mode === 'subtract' ? { kind: 'paint' } : { kind: 'deselect' };
}

/**
 * Applies a rectangle to one district.
 *
 * Either corner may come first; this normalises them, because remembering to sort at the call
 * site is something that eventually gets missed.
 *
 * Replace and subtract touch only this district: replace does not clear another district's cells
 * outside the rectangle, and subtract does not carve out another district's cells inside it. The
 * district being edited is this one, and reaching into another would dismantle its boundary with
 * the player entirely unaware.
 *
 * Cells inside the rectangle belonging to another district are taken. That is not decided here:
 * `addCellToDistrict` already maintains one district per cell, and that is the right behaviour
 * for an overlap, because a cell in two districts has its revenue multiplier and its fees counted
 * twice.
 */
export function paintDistrictRect(
  districts: DistrictManager,
  districtId: string,
  x1: number, y1: number, x2: number, y2: number,
  mode: DistrictPaintMode,
): DistrictPaintResult {
  const result: DistrictPaintResult = { added: 0, removed: 0, fromOthers: new Map() };
  const district = districts.getDistrict(districtId);
  if (!district) return result;

  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

  // Whose cells were touched is counted before painting; afterwards it cannot be recovered.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const owner = districts.getDistrictAt(x, y);
      if (owner && owner.id !== districtId) {
        result.fromOthers.set(owner.id, (result.fromOthers.get(owner.id) ?? 0) + 1);
      } else if (mode === 'subtract') {
        if (owner) result.removed++;
      } else if (!owner) {
        result.added++;
      }
    }
  }
  // Add and replace take other districts' cells, which count as gained here. Subtract does not.
  if (mode !== 'subtract') {
    for (const n of result.fromOthers.values()) result.added += n;
  }

  if (mode === 'replace') {
    // Empty this district first, cell by cell through `removeCellFromDistrict` rather than
    // clearing the Set: the reverse index from cell to district has to be maintained too, and
    // without it `getDistrictAt` points at a district that no longer contains the cell.
    for (const key of [...district.cells]) {
      const { x, y } = parsePosKeyUnsafe(key);
      districts.removeCellFromDistrict(districtId, x, y);
    }
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mode === 'subtract') districts.removeCellFromDistrict(districtId, x, y);
      else districts.addCellToDistrict(districtId, x, y);
    }
  }
  return result;
}

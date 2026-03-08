import type { CellData } from './types';
import { RoadType } from '../road/types';

/**
 * Determine if a cell should have stone (gray) ground instead of terrain color.
 * True for cells with buildings or roads.
 */
export function isStoneGround(cell: CellData): boolean {
  if (cell.buildingId > 0) return true;
  if (cell.roadType !== RoadType.NONE) return true;
  return false;
}

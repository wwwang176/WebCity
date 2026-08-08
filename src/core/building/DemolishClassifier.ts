import { isInfrastructureBuilding, getInfraBuildingId, getInfraConfigById, type InfraType } from './InfraConfig';
import { getInfraCenterById } from './InfraPlacement';

/**
 * Discriminated union for per-cell demolish actions.
 * Replaces nested if-else in Game.ts demolish method (SRP + OCP).
 */
export type DemolishAction =
  | { action: 'multi_cell_infra'; infraType: InfraType; primaryX: number; primaryY: number; cx: number; cy: number }
  | { action: 'single_cell_infra'; infraType: InfraType }
  | { action: 'regular'; hasTrack: boolean }
  | { action: 'skip' };

/**
 * Classify what demolition action to take for a given cell.
 * Pure function — caller provides cell data and findPrimaryCell result.
 *
 * @param cell - The cell data (null if out of bounds)
 * @param primary - Result of findPrimaryCell (null if not a multi-cell building)
 */
export function classifyDemolishCell(
  cell: { buildingId: number; railType: number } | null,
  primary: { x: number; y: number } | null,
): DemolishAction {
  if (!cell) return { action: 'skip' };

  if (!isInfrastructureBuilding(cell.buildingId)) {
    return { action: 'regular', hasTrack: cell.railType !== 0 };
  }

  // Multi-cell infra (including airports): primary cell found → compute center for service removal
  if (primary) {
    const infraCfg = getInfraConfigById(cell.buildingId);
    if (infraCfg) {
      const { cx, cy } = getInfraCenterById(primary.x, primary.y, cell.buildingId);
      return { action: 'multi_cell_infra', infraType: infraCfg.type, primaryX: primary.x, primaryY: primary.y, cx, cy };
    }
  }

  // 1×1 infrastructure (transport stops), and — as a recovery path — any
  // infrastructure cell whose primary cannot be resolved. Falling through to
  // 'regular' would zero the cell WITHOUT calling removeInfraService, leaving a
  // registered facility that is invisible, unselectable and undemolishable
  // forever (BUG-052). Clearing it as a single infra cell at least attempts the
  // service removal and lets the player recover the tile.
  const infraCfg = getInfraConfigById(cell.buildingId);
  if (infraCfg) {
    return { action: 'single_cell_infra', infraType: infraCfg.type };
  }

  return { action: 'regular', hasTrack: cell.railType !== 0 };
}

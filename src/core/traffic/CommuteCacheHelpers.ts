import type { LaneEdge } from './LaneGraph';

/**
 * Collect unique cell keys from a path of lane edges.
 * Extracted from CommuteCache to eliminate duplication between
 * collectRouteCells and collectCellsFromPath (DRY).
 */
export function collectEdgeCells(edges: readonly LaneEdge[]): Set<string> {
  const cells = new Set<string>();
  for (const edge of edges) {
    cells.add(edge.from.cellKey);
    cells.add(edge.to.cellKey);
  }
  return cells;
}

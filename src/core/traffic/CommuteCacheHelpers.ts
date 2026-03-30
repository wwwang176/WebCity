import type { LaneEdge } from './LaneGraph';

/**
 * Collect unique cell keys from a path of lane edges.
 * Extracted from CommuteCache to eliminate duplication between
 * collectRouteCells and collectCellsFromPath (DRY).
 */
export function collectEdgeCells(edges: readonly LaneEdge[], out?: Set<string>): Set<string> {
  const cells = out ?? new Set<string>();
  for (const edge of edges) {
    cells.add(edge.from.cellKey);
    cells.add(edge.to.cellKey);
    if (edge.viaCellKey) cells.add(edge.viaCellKey);
  }
  return cells;
}

import { parsePosKeyUnsafe, euclideanDistance } from '../grid/GridHelpers';
import { GraphNetwork } from '../graph/GraphNetwork';

const parseCoords = parsePosKeyUnsafe;

export class RailNetwork extends GraphNetwork {
  /** A* pathfinding along the rail graph. Returns node IDs from `from` to `to`, or null if unreachable. */
  findPath(from: string, to: string): string[] | null {
    if (!this.adjacency.has(from) || !this.adjacency.has(to)) return null;
    if (from === to) return [from];

    const goal = parseCoords(to);

    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const cameFrom = new Map<string, string>();
    const openSet = new Set<string>();

    gScore.set(from, 0);
    const fromCoords = parseCoords(from);
    fScore.set(from, heuristic(fromCoords, goal));
    openSet.add(from);

    while (openSet.size > 0) {
      // Pick node with lowest fScore
      let current = '';
      let bestF = Infinity;
      for (const node of openSet) {
        const f = fScore.get(node) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          current = node;
        }
      }

      if (current === to) {
        return reconstructPath(cameFrom, current);
      }

      openSet.delete(current);

      const neighbors = this.adjacency.get(current);
      if (!neighbors) continue;

      const currentCoords = parseCoords(current);
      const currentG = gScore.get(current) ?? Infinity;

      for (const neighbor of neighbors) {
        const neighborCoords = parseCoords(neighbor);
        const dx = neighborCoords.x - currentCoords.x;
        const dy = neighborCoords.y - currentCoords.y;
        const edgeCost = Math.sqrt(dx * dx + dy * dy);

        const tentativeG = currentG + edgeCost;
        const prevG = gScore.get(neighbor) ?? Infinity;

        if (tentativeG < prevG) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeG);
          fScore.set(neighbor, tentativeG + heuristic(neighborCoords, goal));
          openSet.add(neighbor);
        }
      }
    }

    return null; // No path found
  }
}

function heuristic(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return euclideanDistance(a.x, a.y, b.x, b.y);
}

function reconstructPath(cameFrom: Map<string, string>, current: string): string[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(current);
  }
  return path;
}

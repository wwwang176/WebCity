import { parsePosKeyUnsafe } from '../grid/GridHelpers';

const parseCoords = parsePosKeyUnsafe;

export class RailNetwork {
  private adjacency = new Map<string, Set<string>>();

  addNode(id: string): void {
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, new Set());
    }
  }

  addEdge(a: string, b: string): void {
    this.addNode(a);
    this.addNode(b);
    this.adjacency.get(a)!.add(b);
    this.adjacency.get(b)!.add(a);
  }

  removeNode(id: string): void {
    const neighbors = this.adjacency.get(id);
    if (neighbors) {
      for (const n of neighbors) {
        this.adjacency.get(n)?.delete(id);
      }
      this.adjacency.delete(id);
    }
  }

  removeEdge(a: string, b: string): void {
    this.adjacency.get(a)?.delete(b);
    this.adjacency.get(b)?.delete(a);
  }

  hasNode(id: string): boolean {
    return this.adjacency.has(id);
  }

  isConnected(a: string, b: string): boolean {
    if (!this.adjacency.has(a) || !this.adjacency.has(b)) return false;
    if (a === b) return true;

    const visited = new Set<string>();
    const queue: string[] = [a];
    visited.add(a);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === b) return true;
      const neighbors = this.adjacency.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }
    return false;
  }

  getNodeCount(): number {
    return this.adjacency.size;
  }

  getEdgeCount(): number {
    let count = 0;
    for (const neighbors of this.adjacency.values()) {
      count += neighbors.size;
    }
    return count / 2;
  }

  getNeighbors(id: string): string[] {
    return Array.from(this.adjacency.get(id) ?? []);
  }

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
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function reconstructPath(cameFrom: Map<string, string>, current: string): string[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(current);
  }
  return path;
}

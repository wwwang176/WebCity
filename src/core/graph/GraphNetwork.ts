/**
 * GraphNetwork — shared undirected graph with BFS connectivity.
 *
 * Base class for RoadNetwork and RailNetwork, eliminating duplicated
 * adjacency-list graph operations.
 *
 * Pure logic module — no Three.js imports.
 */
export class GraphNetwork {
  protected adjacency = new Map<string, Set<string>>();

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
}

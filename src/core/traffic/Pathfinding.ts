import { RoadNetwork } from '../road/RoadNetwork';

interface PathNode {
  id: string;
  g: number;
  h: number;
  f: number;
  parent: string | null;
}

function heuristic(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  return Math.abs(ax! - bx!) + Math.abs(ay! - by!);
}

export interface PathCostFactors {
  congestion: Map<string, number>;
  trafficLights: Set<string>;
}

export function findPath(
  network: RoadNetwork,
  from: string,
  to: string,
  costs?: PathCostFactors,
): string[] | null {
  if (!network.isConnected(from, to)) return null;

  const open = new Map<string, PathNode>();
  const closed = new Set<string>();

  const startNode: PathNode = { id: from, g: 0, h: heuristic(from, to), f: 0, parent: null };
  startNode.f = startNode.g + startNode.h;
  open.set(from, startNode);

  while (open.size > 0) {
    let current: PathNode | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) return null;

    if (current.id === to) {
      const path: string[] = [];
      let node: PathNode | null = current;
      while (node) {
        path.unshift(node.id);
        node = node.parent ? open.get(node.parent) ?? closed.has(node.parent) ? null : null : null;
      }
      // Rebuild path from parents
      const result: string[] = [];
      let cur: string | null = to;
      const parentMap = new Map<string, string | null>();
      // We need to track parents differently
      return rebuildPath(from, to, network, costs);
    }

    open.delete(current.id);
    closed.add(current.id);

    for (const neighborId of network.getNeighbors(current.id)) {
      if (closed.has(neighborId)) continue;

      let moveCost = 1;
      if (costs) {
        const congestion = costs.congestion.get(neighborId) ?? 0;
        moveCost += congestion * 2;
        if (costs.trafficLights.has(neighborId)) moveCost += 0.5;
      }

      const g = current.g + moveCost;
      const existing = open.get(neighborId);

      if (!existing || g < existing.g) {
        const node: PathNode = {
          id: neighborId,
          g,
          h: heuristic(neighborId, to),
          f: g + heuristic(neighborId, to),
          parent: current.id,
        };
        open.set(neighborId, node);
      }
    }
  }

  return null;
}

function rebuildPath(
  from: string,
  to: string,
  network: RoadNetwork,
  costs?: PathCostFactors,
): string[] | null {
  const open = new Map<string, { g: number; parent: string | null }>();
  const closed = new Map<string, { g: number; parent: string | null }>();

  open.set(from, { g: 0, parent: null });

  while (open.size > 0) {
    let bestId = '';
    let bestF = Infinity;

    for (const [id, data] of open) {
      const f = data.g + heuristic(id, to);
      if (f < bestF) {
        bestF = f;
        bestId = id;
      }
    }

    if (bestId === to) {
      const path: string[] = [];
      let cur: string | null = bestId;
      const all = new Map([...open, ...closed]);
      while (cur) {
        path.unshift(cur);
        cur = all.get(cur)?.parent ?? null;
      }
      return path;
    }

    const data = open.get(bestId)!;
    open.delete(bestId);
    closed.set(bestId, data);

    for (const neighborId of network.getNeighbors(bestId)) {
      if (closed.has(neighborId)) continue;

      let moveCost = 1;
      if (costs) {
        const congestion = costs.congestion.get(neighborId) ?? 0;
        moveCost += congestion * 2;
        if (costs.trafficLights.has(neighborId)) moveCost += 0.5;
      }

      const g = data.g + moveCost;
      const existing = open.get(neighborId);

      if (!existing || g < existing.g) {
        open.set(neighborId, { g, parent: bestId });
      }
    }
  }

  return null;
}

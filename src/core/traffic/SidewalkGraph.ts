/**
 * SidewalkGraph — sidewalk network graph for pedestrian pathfinding.
 *
 * Generates sidewalk nodes along road edges (where no adjacent road exists)
 * and connects them with sidewalk, crosswalk, level_crossing, building_access,
 * and transit_access edges.
 */

import { RoadType, RoadDirection, countRoadDirections } from '../road/types';
import { toPosKey, parsePosKeyUnsafe, CARDINAL_DIRECTIONS, euclideanDistance } from '../grid/GridHelpers';

// ── Constants ──────────────────────────────────────────────────────────
// Matches RoadRenderer.ts
export const SIDEWALK_WIDTH = 0.14;

export const ROAD_WIDTHS: Record<number, number> = {
  [RoadType.RURAL]: 0.5,
  [RoadType.TWO_LANE]: 0.6,
  [RoadType.FOUR_LANE]: 0.85,
  [RoadType.SIX_LANE]: 0.95,
  [RoadType.HIGHWAY]: 0.95,
  [RoadType.ONE_WAY]: 0.55,
};

/** Crosswalk offset from intersection center (matches RoadRenderer cwOffset) */
export const CW_OFFSET = 0.35;

/** Node offset within a cell — aligned with crosswalk rendering (cwOffset=0.35) */
const NODE_X_OFFSET = 0.35;

// ── Types ──────────────────────────────────────────────────────────────

export interface SidewalkNode {
  id: string;
  position: { x: number; y: number };
  cellKey: string;
  type: 'sidewalk' | 'crosswalk_wait' | 'building_entrance' | 'transit_stop';
}

export interface SidewalkEdge {
  id: string;
  from: SidewalkNode;
  to: SidewalkNode;
  length: number;
  type: 'sidewalk' | 'crosswalk' | 'level_crossing' | 'building_access' | 'transit_access';
}

export type SidewalkNodeType = SidewalkNode['type'];
export type SidewalkEdgeType = SidewalkEdge['type'];

/** Minimal grid interface (DIP) */
export interface GridLookup {
  getCell(x: number, y: number): { roadType: number; roadFlags: number; railType?: number; railFlags?: number; buildingId?: number; zoneType?: number } | null;
}

// ── Directions for sidewalk sides ──────────────────────────────────────

type Side = 'N' | 'S' | 'W' | 'E';

interface SideInfo {
  side: Side;
  dirFlag: number;
  /** Perpendicular offset from cell center to sidewalk center */
  getOffset(halfWidth: number): { dx: number; dy: number };
  /** Two node positions along the sidewalk on this side */
  getNodePositions(cx: number, cy: number, halfWidth: number): [{ x: number; y: number }, { x: number; y: number }];
  /** Node id suffixes for the two endpoints */
  nodeIds: [string, string];
}

const SIDE_INFOS: SideInfo[] = [
  {
    side: 'N',
    dirFlag: RoadDirection.NORTH,
    getOffset: (h) => ({ dx: 0, dy: -h }),
    getNodePositions: (cx, cy, h) => [
      { x: cx - NODE_X_OFFSET, y: cy - h },
      { x: cx + NODE_X_OFFSET, y: cy - h },
    ],
    nodeIds: ['NW', 'NE'],
  },
  {
    side: 'S',
    dirFlag: RoadDirection.SOUTH,
    getOffset: (h) => ({ dx: 0, dy: h }),
    getNodePositions: (cx, cy, h) => [
      { x: cx - NODE_X_OFFSET, y: cy + h },
      { x: cx + NODE_X_OFFSET, y: cy + h },
    ],
    nodeIds: ['SW', 'SE'],
  },
  {
    side: 'W',
    dirFlag: RoadDirection.WEST,
    getOffset: (h) => ({ dx: -h, dy: 0 }),
    getNodePositions: (cx, cy, h) => [
      { x: cx - h, y: cy - NODE_X_OFFSET },
      { x: cx - h, y: cy + NODE_X_OFFSET },
    ],
    nodeIds: ['WN', 'WS'],
  },
  {
    side: 'E',
    dirFlag: RoadDirection.EAST,
    getOffset: (h) => ({ dx: h, dy: 0 }),
    getNodePositions: (cx, cy, h) => [
      { x: cx + h, y: cy - NODE_X_OFFSET },
      { x: cx + h, y: cy + NODE_X_OFFSET },
    ],
    nodeIds: ['EN', 'ES'],
  },
];

// ── SidewalkGraph class ────────────────────────────────────────────────

export class SidewalkGraph {
  private nodes = new Map<string, SidewalkNode>();
  private adjacency = new Map<string, SidewalkEdge[]>();
  private cellNodes = new Map<string, string[]>();

  // ── Build ──

  buildFromGrid(grid: GridLookup, roadCellKeys: string[]): void {
    this.nodes.clear();
    this.adjacency.clear();
    this.cellNodes.clear();

    // Pass 1: generate nodes for each road cell
    for (const key of roadCellKeys) {
      this.generateNodesForCell(grid, key);
    }

    // Pass 2: generate edges
    for (const key of roadCellKeys) {
      this.generateEdgesForCell(grid, key);
    }
  }

  updateCells(grid: GridLookup, affectedCellKeys: string[]): void {
    // Collect affected cells + their neighbors (same as LaneGraph pattern)
    const toRebuild = new Set<string>();
    for (const key of affectedCellKeys) {
      toRebuild.add(key);
      const { x, y } = parsePosKeyUnsafe(key);
      for (const dir of CARDINAL_DIRECTIONS) {
        toRebuild.add(toPosKey(x + dir.dx, y + dir.dy));
      }
    }

    // Remove old nodes and edges for affected cells
    for (const key of toRebuild) {
      this.removeCellData(key);
    }

    // Rebuild nodes
    for (const key of toRebuild) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        this.generateNodesForCell(grid, key);
      }
    }

    // Rebuild edges
    for (const key of toRebuild) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        this.generateEdgesForCell(grid, key);
      }
    }
  }

  // ── Queries ──

  getNode(nodeId: string): SidewalkNode | undefined {
    return this.nodes.get(nodeId);
  }

  getEdgesFrom(nodeId: string): SidewalkEdge[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  getNodesInCell(cellKey: string): SidewalkNode[] {
    const ids = this.cellNodes.get(cellKey) ?? [];
    return ids.map(id => this.nodes.get(id)!).filter(Boolean);
  }

  getAllNodes(): SidewalkNode[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): SidewalkEdge[] {
    const seen = new Set<string>();
    const result: SidewalkEdge[] = [];
    for (const edges of this.adjacency.values()) {
      for (const e of edges) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          result.push(e);
        }
      }
    }
    return result;
  }

  /** Max search radius for findNearestNode (cells). Beyond this, return null. */
  static readonly MAX_NEAREST_DISTANCE = 2;

  findNearestNode(bx: number, by: number): SidewalkNode | null {
    let best: SidewalkNode | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      if (node.type === 'building_entrance' || node.type === 'transit_stop') continue;
      const d = euclideanDistance(bx, by, node.position.x, node.position.y);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    // Reject matches too far away — prevents pedestrians on unrelated roads
    if (bestDist > SidewalkGraph.MAX_NEAREST_DISTANCE) return null;
    return best;
  }

  // ── A* Pathfinding ──

  findPath(fromNodeId: string, toNodeId: string): SidewalkEdge[] | null {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) return null;
    if (fromNodeId === toNodeId) return [];

    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const cameFrom = new Map<string, { nodeId: string; edge: SidewalkEdge }>();

    gScore.set(fromNodeId, 0);
    fScore.set(fromNodeId, this.heuristic(fromNode, toNode));

    // Simple priority queue (array sorted by fScore)
    const openSet = new Set<string>([fromNodeId]);

    while (openSet.size > 0) {
      // Pick node with lowest fScore
      let currentId = '';
      let currentF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < currentF) {
          currentF = f;
          currentId = id;
        }
      }

      if (currentId === toNodeId) {
        return this.reconstructPath(cameFrom, toNodeId);
      }

      openSet.delete(currentId);
      const currentG = gScore.get(currentId) ?? Infinity;

      for (const edge of this.getEdgesFrom(currentId)) {
        const neighborId = edge.to.id;
        const tentativeG = currentG + edge.length;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, { nodeId: currentId, edge });
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.heuristic(edge.to, toNode));
          openSet.add(neighborId);
        }
      }
    }

    return null; // No path found
  }

  // ── Private: Node generation ──

  private generateNodesForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parsePosKeyUnsafe(cellKey);
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return;

    const roadFlags = cell.roadFlags;
    const halfWidth = (ROAD_WIDTHS[cell.roadType] ?? 0.6) / 2;
    const nodeIds: string[] = [];

    for (const sideInfo of SIDE_INFOS) {
      // Sidewalk exists on sides WITHOUT an adjacent road
      if (roadFlags & sideInfo.dirFlag) continue;

      const positions = sideInfo.getNodePositions(x, y, halfWidth);
      for (let i = 0; i < 2; i++) {
        const nodeId = `${cellKey}:${sideInfo.nodeIds[i]}`;
        const node: SidewalkNode = {
          id: nodeId,
          position: positions[i]!,
          cellKey,
          type: 'sidewalk',
        };
        this.nodes.set(nodeId, node);
        nodeIds.push(nodeId);
      }
    }

    this.cellNodes.set(cellKey, nodeIds);
  }

  private generateEdgesForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parsePosKeyUnsafe(cellKey);
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return;

    const roadFlags = cell.roadFlags;

    // Type 1: Within-cell sidewalk edges (same side, two nodes)
    for (const sideInfo of SIDE_INFOS) {
      if (roadFlags & sideInfo.dirFlag) continue;
      const id0 = `${cellKey}:${sideInfo.nodeIds[0]}`;
      const id1 = `${cellKey}:${sideInfo.nodeIds[1]}`;
      const n0 = this.nodes.get(id0);
      const n1 = this.nodes.get(id1);
      if (n0 && n1) {
        this.addBidirectionalEdge(n0, n1, 'sidewalk');
      }
    }

    // Type 2: Cross-cell sidewalk edges (connect to neighbor's same-side nodes)
    this.generateCrossCellEdges(grid, x, y, cellKey, cell);

    // Type 3: Crosswalk edges (at intersections with ≥3 connections)
    this.generateCrosswalkEdges(grid, x, y, cellKey, cell);

    // Type 5: Level crossing edges
    if (cell.railType && cell.railType !== 0) {
      this.generateLevelCrossingEdges(grid, x, y, cellKey, cell);
    }
  }

  private generateCrossCellEdges(
    grid: GridLookup, x: number, y: number, cellKey: string,
    cell: { roadType: number; roadFlags: number },
  ): void {
    // Connect adjacent cells' sidewalk nodes on the shared boundary
    // North-South connections: NE↔(neighbor's)NW on the same horizontal sidewalk
    // East-West connections: WS↔(neighbor's)WN on the same vertical sidewalk

    const connections: Array<{
      dirFlag: number; nx: number; ny: number;
      myNode: string; neighborNode: string;
    }> = [
      // My east node connects to neighbor-east's west node (north sidewalk)
      { dirFlag: RoadDirection.EAST, nx: x + 1, ny: y, myNode: `${cellKey}:NE`, neighborNode: `${toPosKey(x + 1, y)}:NW` },
      { dirFlag: RoadDirection.EAST, nx: x + 1, ny: y, myNode: `${cellKey}:SE`, neighborNode: `${toPosKey(x + 1, y)}:SW` },
      // My south node connects to neighbor-south's north node (west sidewalk)
      { dirFlag: RoadDirection.SOUTH, nx: x, ny: y + 1, myNode: `${cellKey}:WS`, neighborNode: `${toPosKey(x, y + 1)}:WN` },
      { dirFlag: RoadDirection.SOUTH, nx: x, ny: y + 1, myNode: `${cellKey}:ES`, neighborNode: `${toPosKey(x, y + 1)}:EN` },
    ];

    for (const conn of connections) {
      // Both cells must have this direction connected (road continues)
      if (!(cell.roadFlags & conn.dirFlag)) continue;
      const neighbor = grid.getCell(conn.nx, conn.ny);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const myNode = this.nodes.get(conn.myNode);
      const neighborNode = this.nodes.get(conn.neighborNode);
      if (myNode && neighborNode) {
        this.addBidirectionalEdge(myNode, neighborNode, 'sidewalk');
      }
    }
  }

  private generateCrosswalkEdges(
    grid: GridLookup, x: number, y: number, _cellKey: string,
    cell: { roadType: number; roadFlags: number },
  ): void {
    const dirCount = countRoadDirections(cell.roadFlags);
    if (dirCount < 3) return; // Only at intersections

    // For each direction connected to this intersection,
    // the neighbor cell gets a crosswalk connecting its two sidewalk sides
    const directions: Array<{
      dirFlag: number; dx: number; dy: number;
      // The two sidewalk node pairs on the neighbor that the crosswalk connects
      fromSuffix: string; toSuffix: string;
    }> = [
      // North neighbor: crosswalk connects its west and east sidewalks
      { dirFlag: RoadDirection.NORTH, dx: 0, dy: -1, fromSuffix: 'WS', toSuffix: 'ES' },
      // South neighbor
      { dirFlag: RoadDirection.SOUTH, dx: 0, dy: 1, fromSuffix: 'WN', toSuffix: 'EN' },
      // West neighbor
      { dirFlag: RoadDirection.WEST, dx: -1, dy: 0, fromSuffix: 'NE', toSuffix: 'SE' },
      // East neighbor
      { dirFlag: RoadDirection.EAST, dx: 1, dy: 0, fromSuffix: 'NW', toSuffix: 'SW' },
    ];

    for (const dir of directions) {
      if (!(cell.roadFlags & dir.dirFlag)) continue;
      const neighborKey = toPosKey(x + dir.dx, y + dir.dy);
      const neighbor = grid.getCell(x + dir.dx, y + dir.dy);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const fromNode = this.nodes.get(`${neighborKey}:${dir.fromSuffix}`);
      const toNode = this.nodes.get(`${neighborKey}:${dir.toSuffix}`);
      if (fromNode && toNode) {
        this.addBidirectionalEdge(fromNode, toNode, 'crosswalk');
      }
    }
  }

  private generateLevelCrossingEdges(
    grid: GridLookup, x: number, y: number, cellKey: string,
    cell: { roadType: number; roadFlags: number; railType?: number },
  ): void {
    if (!cell.railType || cell.railType === 0) return;

    // Level crossing: connect sidewalk nodes across the rail tracks
    // If road is horizontal (E-W), rail crosses vertically → connect N and S sidewalks
    // If road is vertical (N-S), rail crosses horizontally → connect W and E sidewalks
    const hasN = (cell.roadFlags & RoadDirection.NORTH) !== 0;
    const hasS = (cell.roadFlags & RoadDirection.SOUTH) !== 0;
    const hasE = (cell.roadFlags & RoadDirection.EAST) !== 0;
    const hasW = (cell.roadFlags & RoadDirection.WEST) !== 0;

    if (hasN || hasS) {
      // Vertical road with rail crossing: connect W↔E sidewalk nodes
      const pairs: [string, string][] = [
        [`${cellKey}:WN`, `${cellKey}:EN`],
        [`${cellKey}:WS`, `${cellKey}:ES`],
      ];
      for (const [fromId, toId] of pairs) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);
        if (from && to) this.addBidirectionalEdge(from, to, 'level_crossing');
      }
    }

    if (hasE || hasW) {
      // Horizontal road with rail crossing: connect N↔S sidewalk nodes
      const pairs: [string, string][] = [
        [`${cellKey}:NW`, `${cellKey}:SW`],
        [`${cellKey}:NE`, `${cellKey}:SE`],
      ];
      for (const [fromId, toId] of pairs) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);
        if (from && to) this.addBidirectionalEdge(from, to, 'level_crossing');
      }
    }
  }

  // ── Private: Edge helpers ──

  private addBidirectionalEdge(a: SidewalkNode, b: SidewalkNode, type: SidewalkEdge['type']): void {
    const length = euclideanDistance(a.position.x, a.position.y, b.position.x, b.position.y);
    const edgeAB: SidewalkEdge = {
      id: `${a.id}→${b.id}`,
      from: a, to: b, length, type,
    };
    const edgeBA: SidewalkEdge = {
      id: `${b.id}→${a.id}`,
      from: b, to: a, length, type,
    };

    if (!this.adjacency.has(a.id)) this.adjacency.set(a.id, []);
    if (!this.adjacency.has(b.id)) this.adjacency.set(b.id, []);

    // Avoid duplicates
    const aEdges = this.adjacency.get(a.id)!;
    if (!aEdges.some(e => e.id === edgeAB.id)) aEdges.push(edgeAB);

    const bEdges = this.adjacency.get(b.id)!;
    if (!bEdges.some(e => e.id === edgeBA.id)) bEdges.push(edgeBA);
  }

  private removeCellData(cellKey: string): void {
    const nodeIds = this.cellNodes.get(cellKey) ?? [];
    for (const nodeId of nodeIds) {
      // Remove edges from this node
      const edges = this.adjacency.get(nodeId) ?? [];
      for (const edge of edges) {
        // Remove reverse edge from the other node
        const otherEdges = this.adjacency.get(edge.to.id);
        if (otherEdges) {
          const reverseId = `${edge.to.id}→${nodeId}`;
          const idx = otherEdges.findIndex(e => e.id === reverseId);
          if (idx >= 0) otherEdges.splice(idx, 1);
        }
      }
      this.adjacency.delete(nodeId);
      this.nodes.delete(nodeId);
    }
    this.cellNodes.delete(cellKey);
  }

  // ── Private: A* helpers ──

  private heuristic(a: SidewalkNode, b: SidewalkNode): number {
    return euclideanDistance(a.position.x, a.position.y, b.position.x, b.position.y);
  }

  private reconstructPath(
    cameFrom: Map<string, { nodeId: string; edge: SidewalkEdge }>,
    endNodeId: string,
  ): SidewalkEdge[] {
    const path: SidewalkEdge[] = [];
    let current = endNodeId;
    while (cameFrom.has(current)) {
      const { nodeId, edge } = cameFrom.get(current)!;
      path.push(edge);
      current = nodeId;
    }
    path.reverse();
    return path;
  }
}

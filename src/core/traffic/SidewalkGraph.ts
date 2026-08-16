/**
 * SidewalkGraph — sidewalk network graph for pedestrian pathfinding.
 *
 * Generates sidewalk nodes along road edges (where no adjacent road exists)
 * and connects them with sidewalk, crosswalk, level_crossing, building_access
 * and building_wall edges.
 *
 * 站牌沒有自己的節點種類：它在這張圖裡就是一棟 1×1 建築，四個門節點靠
 * building_access 接上路邊。`transit_stop` / `transit_access` 這兩種曾經宣告在
 * 型別裡（連這段註解都寫著會產生），但沒有一行程式碼建立過它們 —— 已移除。
 */

import { RoadType, RoadDirection, countRoadDirections, ROAD_WIDTHS } from '../road/types';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../grid/constants';
import { toPosKey, parsePosKeyUnsafe, CARDINAL_DIRECTIONS, euclideanDistance } from '../grid/GridHelpers';

// ── Constants ──────────────────────────────────────────────────────────
// Matches RoadRenderer.ts
export const SIDEWALK_WIDTH = 0.14;

/** 路寬的家在 `core/road/types`。這裡轉出去，既有的 import 不必動。 */
export { ROAD_WIDTHS };

/** Crosswalk offset from intersection center (matches RoadRenderer cwOffset) */
export const CW_OFFSET = 0.35;

/** Node offset within a cell — aligned with crosswalk rendering */
const NODE_X_OFFSET = CW_OFFSET;

/**
 * Building wall distance from cell center.
 *
 * 由 MAX_BUILDING_WIDTH_M 推導，而不是自己寫一個數字：渲染層的基地寬度表
 * 用的是同一個上限，兩邊各自寫死會在建築變寬時讓行人走進牆裡。
 */
export const BUILDING_HALF_SIZE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** Walkway node offset outside building wall */
export const WALKWAY_OFFSET = 0.06;

/** Distance from cell center to door nodes */
const DOOR_NODE_DIST = BUILDING_HALF_SIZE + WALKWAY_OFFSET;

/** Distance from cell center to corner nodes (pushed out so corners don't overlap doors) */
const CORNER_NODE_DIST = DOOR_NODE_DIST + WALKWAY_OFFSET / 2;

// ── Types ──────────────────────────────────────────────────────────────

export interface SidewalkNode {
  id: string;
  position: { x: number; y: number };
  cellKey: string;
  type: 'sidewalk' | 'building_entrance' | 'building_corner';
  /**
   * The road tier whose width put this node where it is, or 0 for nodes not
   * placed off a carriageway (doors and corners).
   *
   * Node ids are `cellKey:side` and say nothing about position, but position
   * comes from ROAD_WIDTHS[roadType] — so this is carried here and folded into
   * the EDGE id, which is what retirement compares (BUG-159).
   */
  roadType: number;
}

export interface SidewalkEdge {
  id: string;
  from: SidewalkNode;
  to: SidewalkNode;
  length: number;
  type: 'sidewalk' | 'crosswalk' | 'level_crossing' | 'building_access' | 'building_wall';
  /** The intersection cell that controls this crosswalk/bridge (for traffic light query) */
  intersectionCellKey?: string;
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
  /** 所有還活著的邊 id，隨增刪維護 —— 見 getEdgeIds。 */
  private readonly edgeIds = new Set<string>();
  private generation = 0;

  /**
   * Bumped on every structural change.
   *
   * Anything that caches a graph-derived answer compares this to decide whether
   * its answer is still valid. Callers that know WHICH cells moved should
   * invalidate precisely; this is the safety net for the ones that forget, and
   * for wholesale rebuilds where "which cells" is every cell.
   */
  get version(): number { return this.generation; }

  // ── Build ──

  buildFromGrid(grid: GridLookup, roadCellKeys: string[], buildingCellKeys: string[] = []): void {
    this.generation++;
    this.nodes.clear();
    this.adjacency.clear();
    this.cellNodes.clear();
    this.edgeIds.clear();

    // Pass 1: generate nodes for each road cell
    for (const key of roadCellKeys) {
      this.generateNodesForCell(grid, key);
    }

    // Pass 2: generate road edges
    for (const key of roadCellKeys) {
      this.generateEdgesForCell(grid, key);
    }

    // Pass 3: generate building nodes
    for (const key of buildingCellKeys) {
      this.generateBuildingNodesForCell(grid, key);
    }

    // Pass 4: generate building edges (must be after road nodes exist)
    for (const key of buildingCellKeys) {
      this.generateBuildingEdgesForCell(grid, key);
    }
  }

  updateCells(grid: GridLookup, affectedCellKeys: string[]): void {
    this.generation++;
    // Collect affected cells + their neighbors (same as LaneGraph pattern)
    const toRebuild = new Set<string>();
    for (const key of affectedCellKeys) {
      toRebuild.add(key);
      const { x, y } = parsePosKeyUnsafe(key);
      for (const dir of CARDINAL_DIRECTIONS) {
        toRebuild.add(toPosKey(x + dir.dx, y + dir.dy));
      }
    }

    // Cells whose EDGES must be regenerated: one ring wider than the nodes.
    //
    // removeCellData deletes both directions of every edge touching a cell, but
    // generateCrossCellEdges emits links only for EAST and SOUTH — so the
    // WEST/NORTH link between a rebuilt cell and the cell beyond it is owned
    // exclusively by that outside cell. Crosswalk and intersection-bridge edges
    // have the same one-way ownership (they are emitted by the intersection but
    // connect a neighbour's nodes). Without regenerating the outer ring those
    // links are destroyed and never recreated (BUG-067).
    //
    // addBidirectionalEdge dedupes by id, so re-running an owner whose edges
    // survived is a no-op rather than a duplicate.
    const edgeOwners = new Set<string>(toRebuild);
    for (const key of toRebuild) {
      const { x, y } = parsePosKeyUnsafe(key);
      for (const dir of CARDINAL_DIRECTIONS) {
        edgeOwners.add(toPosKey(x + dir.dx, y + dir.dy));
      }
    }

    // Remove old nodes and edges for affected cells
    for (const key of toRebuild) {
      this.removeCellData(key);
    }

    // Rebuild road nodes
    for (const key of toRebuild) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        this.generateNodesForCell(grid, key);
      }
    }

    // Rebuild road edges
    for (const key of edgeOwners) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType !== RoadType.NONE) {
        this.generateEdgesForCell(grid, key);
      }
    }

    // Rebuild building nodes
    for (const key of toRebuild) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType === RoadType.NONE && cell.buildingId && cell.buildingId > 0) {
        this.generateBuildingNodesForCell(grid, key);
      }
    }

    // Rebuild building edges
    for (const key of edgeOwners) {
      const { x, y } = parsePosKeyUnsafe(key);
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType === RoadType.NONE && cell.buildingId && cell.buildingId > 0) {
        this.generateBuildingEdgesForCell(grid, key);
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

  /**
   * Every live edge id.
   *
   * 隨著邊的增刪一起維護，而不是每次呼叫掃一遍鄰接表。呼叫端是行人的退休掃描，
   * 而它跑在每一次道路編輯上：60×60 全鋪滿約十萬條邊，掃一遍要 12 ms —— 在
   * `updateCells` 只花 0.3 ms 的旁邊，等於整個增量重建都白做了。
   */
  getEdgeIds(): ReadonlySet<string> {
    return this.edgeIds;
  }

  /** Max search radius for findNearestNode (cells). Beyond this, return null. */
  static readonly MAX_NEAREST_DISTANCE = 2;

  findNearestNode(bx: number, by: number): SidewalkNode | null {
    let best: SidewalkNode | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
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
    return this.findPathMultiTarget(fromNodeId, [toNodeId]);
  }

  /**
   * Multi-target A*: finds shortest path from fromNodeId to ANY of toNodeIds.
   * Heuristic uses min distance to all targets (admissible).
   */
  findPathMultiTarget(fromNodeId: string, toNodeIds: string[]): SidewalkEdge[] | null {
    const fromNode = this.nodes.get(fromNodeId);
    if (!fromNode) return null;

    // Resolve target nodes
    const targetSet = new Set<string>();
    const targetNodes: SidewalkNode[] = [];
    for (const id of toNodeIds) {
      const node = this.nodes.get(id);
      if (node) {
        targetSet.add(id);
        targetNodes.push(node);
      }
    }
    if (targetNodes.length === 0) return null;
    if (targetSet.has(fromNodeId)) return [];

    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const cameFrom = new Map<string, { nodeId: string; edge: SidewalkEdge }>();

    gScore.set(fromNodeId, 0);
    fScore.set(fromNodeId, this.heuristicMulti(fromNode, targetNodes));

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

      if (targetSet.has(currentId)) {
        return this.reconstructPath(cameFrom, currentId);
      }

      openSet.delete(currentId);
      const currentG = gScore.get(currentId) ?? Infinity;

      for (const edge of this.getEdgesFrom(currentId)) {
        const neighborId = edge.to.id;
        const tentativeG = currentG + edge.length;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, { nodeId: currentId, edge });
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.heuristicMulti(edge.to, targetNodes));
          openSet.add(neighborId);
        }
      }
    }

    return null;
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
          roadType: cell.roadType,
        };
        this.nodes.set(nodeId, node);
        nodeIds.push(nodeId);
      }
    }

    this.cellNodes.set(cellKey, nodeIds);
  }

  // ── Private: Building node generation ──

  private generateBuildingNodesForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parsePosKeyUnsafe(cellKey);
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType !== RoadType.NONE || !cell.buildingId || cell.buildingId === 0) return;

    const cd = CORNER_NODE_DIST;
    const dd = DOOR_NODE_DIST;
    const nodeIds: string[] = [];

    // 4 corner nodes (pushed out further than doors)
    const corners: Array<{ suffix: string; px: number; py: number }> = [
      { suffix: 'bNW', px: x - cd, py: y - cd },
      { suffix: 'bNE', px: x + cd, py: y - cd },
      { suffix: 'bSW', px: x - cd, py: y + cd },
      { suffix: 'bSE', px: x + cd, py: y + cd },
    ];
    for (const c of corners) {
      const nodeId = `${cellKey}:${c.suffix}`;
      this.nodes.set(nodeId, { id: nodeId, position: { x: c.px, y: c.py }, cellKey, type: 'building_corner', roadType: 0 });
      nodeIds.push(nodeId);
    }

    // 4 door nodes (centered on each face, at wall line)
    const doors: Array<{ suffix: string; px: number; py: number }> = [
      { suffix: 'bN', px: x, py: y - dd },
      { suffix: 'bS', px: x, py: y + dd },
      { suffix: 'bW', px: x - dd, py: y },
      { suffix: 'bE', px: x + dd, py: y },
    ];
    for (const door of doors) {
      const nodeId = `${cellKey}:${door.suffix}`;
      this.nodes.set(nodeId, { id: nodeId, position: { x: door.px, y: door.py }, cellKey, type: 'building_entrance', roadType: 0 });
      nodeIds.push(nodeId);
    }

    this.cellNodes.set(cellKey, nodeIds);
  }

  private generateBuildingEdgesForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parsePosKeyUnsafe(cellKey);
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType !== RoadType.NONE || !cell.buildingId || cell.buildingId === 0) return;

    // Type 1: Building wall edges — triangle per face:
    //   corner1 ↔ corner2 (wall line, doesn't pass through door)
    //   corner1 ↔ door    (diagonal approach)
    //   corner2 ↔ door    (diagonal approach)
    const wallFaces: Array<{ c1: string; door: string; c2: string }> = [
      { c1: `${cellKey}:bNW`, door: `${cellKey}:bN`, c2: `${cellKey}:bNE` },
      { c1: `${cellKey}:bSW`, door: `${cellKey}:bS`, c2: `${cellKey}:bSE` },
      { c1: `${cellKey}:bNW`, door: `${cellKey}:bW`, c2: `${cellKey}:bSW` },
      { c1: `${cellKey}:bNE`, door: `${cellKey}:bE`, c2: `${cellKey}:bSE` },
    ];
    for (const face of wallFaces) {
      const c1 = this.nodes.get(face.c1);
      const door = this.nodes.get(face.door);
      const c2 = this.nodes.get(face.c2);
      if (c1 && c2) this.addBidirectionalEdge(c1, c2, 'building_wall');
      if (c1 && door) this.addBidirectionalEdge(c1, door, 'building_wall');
      if (c2 && door) this.addBidirectionalEdge(c2, door, 'building_wall');
    }

    // Type 2: Building access edges (door + corners → road sidewalk nodes)
    const accessDirs: Array<{
      dx: number; dy: number;
      doorSuffix: string;
      cornerSuffixes: [string, string];
      // The road sidewalk node suffixes on the shared boundary
      roadNodeSuffixes: [string, string];
    }> = [
      { dx: 0, dy: -1, doorSuffix: 'bN', cornerSuffixes: ['bNW', 'bNE'], roadNodeSuffixes: ['SW', 'SE'] },
      { dx: 0, dy: 1,  doorSuffix: 'bS', cornerSuffixes: ['bSW', 'bSE'], roadNodeSuffixes: ['NW', 'NE'] },
      { dx: -1, dy: 0, doorSuffix: 'bW', cornerSuffixes: ['bNW', 'bSW'], roadNodeSuffixes: ['EN', 'ES'] },
      { dx: 1,  dy: 0, doorSuffix: 'bE', cornerSuffixes: ['bNE', 'bSE'], roadNodeSuffixes: ['WN', 'WS'] },
    ];
    for (const dir of accessDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      const neighbor = grid.getCell(nx, ny);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const neighborKey = toPosKey(nx, ny);

      // Door → both road nodes
      const doorNode = this.nodes.get(`${cellKey}:${dir.doorSuffix}`);
      if (doorNode) {
        for (const suffix of dir.roadNodeSuffixes) {
          const roadNode = this.nodes.get(`${neighborKey}:${suffix}`);
          if (roadNode) this.addBidirectionalEdge(doorNode, roadNode, 'building_access');
        }
      }

      // Corners → nearest road node (each corner connects to the closer road node)
      for (let i = 0; i < 2; i++) {
        const cornerNode = this.nodes.get(`${cellKey}:${dir.cornerSuffixes[i]}`);
        const roadNode = this.nodes.get(`${neighborKey}:${dir.roadNodeSuffixes[i]}`);
        if (cornerNode && roadNode) this.addBidirectionalEdge(cornerNode, roadNode, 'building_access');
      }
    }

    // Type 3: Adjacent building connections (corner↔corner)
    const adjDirs: Array<{
      dx: number; dy: number;
      myCorners: [string, string];
      theirCorners: [string, string];
    }> = [
      { dx: 1, dy: 0,  myCorners: ['bNE', 'bSE'], theirCorners: ['bNW', 'bSW'] }, // east
      { dx: 0, dy: 1,  myCorners: ['bSW', 'bSE'], theirCorners: ['bNW', 'bNE'] }, // south
    ];
    for (const dir of adjDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      const neighbor = grid.getCell(nx, ny);
      if (!neighbor || neighbor.roadType !== RoadType.NONE || !neighbor.buildingId || neighbor.buildingId === 0) continue;

      const neighborKey = toPosKey(nx, ny);
      for (let i = 0; i < 2; i++) {
        const myNode = this.nodes.get(`${cellKey}:${dir.myCorners[i]}`);
        const theirNode = this.nodes.get(`${neighborKey}:${dir.theirCorners[i]}`);
        if (myNode && theirNode) this.addBidirectionalEdge(myNode, theirNode, 'building_wall');
      }
    }
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

    // Type 4: Intersection bridge edges (connect boundary nodes of neighbors
    // through intersection cells that have no nodes of their own)
    this.generateIntersectionBridgeEdges(grid, x, y, cell);

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
        this.addBidirectionalEdge(fromNode, toNode, 'crosswalk', toPosKey(x, y));
      }
    }
  }

  /**
   * At intersection cells with 3+ connections, the cell itself may have
   * few or zero sidewalk nodes. Corner bridges connect boundary nodes
   * of adjacent neighbor cells at intersection corners, so pedestrians
   * cross via: corner bridge → crosswalk → corner bridge.
   *
   * Only corner turns (NW, NE, SW, SE) — no straight-through bridges,
   * which would let pedestrians cut through the intersection center.
   */
  private generateIntersectionBridgeEdges(
    grid: GridLookup, x: number, y: number,
    cell: { roadType: number; roadFlags: number },
  ): void {
    const dirCount = countRoadDirections(cell.roadFlags);
    if (dirCount < 3) return;

    const flags = cell.roadFlags;
    const iKey = toPosKey(x, y);

    const getNode = (dx: number, dy: number, suffix: string) => {
      const n = grid.getCell(x + dx, y + dy);
      if (!n || n.roadType === RoadType.NONE) return undefined;
      return this.nodes.get(`${toPosKey(x + dx, y + dy)}:${suffix}`);
    };

    // Corner bridges only (perpendicular directions)
    if ((flags & RoadDirection.NORTH) && (flags & RoadDirection.WEST))
      this.bridgePair(getNode(0, -1, 'WS'), getNode(-1, 0, 'NE'), iKey);
    if ((flags & RoadDirection.NORTH) && (flags & RoadDirection.EAST))
      this.bridgePair(getNode(0, -1, 'ES'), getNode(1, 0, 'NW'), iKey);
    if ((flags & RoadDirection.SOUTH) && (flags & RoadDirection.WEST))
      this.bridgePair(getNode(0, 1, 'WN'), getNode(-1, 0, 'SE'), iKey);
    if ((flags & RoadDirection.SOUTH) && (flags & RoadDirection.EAST))
      this.bridgePair(getNode(0, 1, 'EN'), getNode(1, 0, 'SW'), iKey);
  }

  private bridgePair(a: SidewalkNode | undefined, b: SidewalkNode | undefined, _intersectionCellKey: string): void {
    // Corner bridges are sidewalk type — they don't cross any road,
    // just connect two sidewalk nodes at the intersection corner.
    // Traffic light checks happen at the actual crosswalk edges.
    if (a && b) this.addBidirectionalEdge(a, b, 'sidewalk');
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

  private addBidirectionalEdge(a: SidewalkNode, b: SidewalkNode, type: SidewalkEdge['type'], intersectionCellKey?: string): void {
    const length = euclideanDistance(a.position.x, a.position.y, b.position.x, b.position.y);
    // `type` and `intersectionCellKey` are part of the identity, not decoration.
    // The same node pair is emitted as a crosswalk by generateCrosswalkEdges
    // and as a level_crossing by generateLevelCrossingEdges; with the id built
    // from the endpoints alone they collided and the dedupe below kept
    // whichever generator happened to run first — decided by cell processing
    // order. PedestrianManager gates on `nextEdge.type === 'crosswalk'`, so
    // pedestrians at such a junction walked straight through the traffic light
    // that had just been wired up (BUG-160).
    // Everything that decides what this edge IS goes into its id: the kind of
    // edge, the junction that governs it, and the road widths that placed its
    // endpoints. Retirement-by-edge-identity assumes same id implies same edge.
    const kind = intersectionCellKey ? `${type}@${intersectionCellKey}` : type;
    const geom = `${a.roadType}/${b.roadType}`;
    const edgeAB: SidewalkEdge = {
      id: `${kind}|${geom}:${a.id}→${b.id}`,
      from: a, to: b, length, type, intersectionCellKey,
    };
    const edgeBA: SidewalkEdge = {
      id: `${kind}|${geom}:${b.id}→${a.id}`,
      from: b, to: a, length, type, intersectionCellKey,
    };

    if (!this.adjacency.has(a.id)) this.adjacency.set(a.id, []);
    if (!this.adjacency.has(b.id)) this.adjacency.set(b.id, []);

    // Avoid duplicates
    const aEdges = this.adjacency.get(a.id)!;
    if (!aEdges.some(e => e.id === edgeAB.id)) { aEdges.push(edgeAB); this.edgeIds.add(edgeAB.id); }

    const bEdges = this.adjacency.get(b.id)!;
    if (!bEdges.some(e => e.id === edgeBA.id)) { bEdges.push(edgeBA); this.edgeIds.add(edgeBA.id); }
  }

  private removeCellData(cellKey: string): void {
    const nodeIds = this.cellNodes.get(cellKey) ?? [];
    for (const nodeId of nodeIds) {
      // Remove edges from this node
      const edges = this.adjacency.get(nodeId) ?? [];
      for (const edge of edges) {
        this.edgeIds.delete(edge.id);
        // 反向那一條由對面持有，也得刪掉。
        //
        // 原本是拿 `${to.id}→${nodeId}` 組出反向 id 去比對，但 id 裡還含有邊的
        // 種類與兩端的路寬（BUG-159、BUG-160 先後折進去的），所以那個 findIndex
        // 一次都沒有命中過 —— 對面手上永遠留著一條指向已刪節點的邊，A* 走得過去，
        // 行人於是走在已經不存在的人行道上。
        //
        // 改成直接看終點是誰。同一對節點之間可能有不只一條邊（斑馬線與平交道就
        // 會重疊在同一對上），指向被刪節點的通通要走，所以是迴圈不是 findIndex。
        const otherEdges = this.adjacency.get(edge.to.id);
        if (otherEdges) {
          for (let i = otherEdges.length - 1; i >= 0; i--) {
            const back = otherEdges[i]!;
            if (back.to.id !== nodeId) continue;
            this.edgeIds.delete(back.id);
            otherEdges.splice(i, 1);
          }
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

  private heuristicMulti(a: SidewalkNode, targets: SidewalkNode[]): number {
    let min = Infinity;
    for (const t of targets) {
      const d = euclideanDistance(a.position.x, a.position.y, t.position.x, t.position.y);
      if (d < min) min = d;
    }
    return min;
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

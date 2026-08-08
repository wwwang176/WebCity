/**
 * PedestrianManager — manages pedestrian agents.
 *
 * Spawns, moves, and despawns pedestrians along the sidewalk graph.
 * Uses a WalkingTripPool for probability-based spawning proportional
 * to actual commute mode distribution.
 */

import { SidewalkGraph, SidewalkEdge } from './SidewalkGraph';
import { PedestrianAgent, PedestrianState, PedestrianTripType } from './PedestrianAgent';
import { euclideanDistance, toPosKey } from '../grid/GridHelpers';

// ── Constants ──────────────────────────────────────────────────────────

export const PEDESTRIAN = {
  SPEED: 0.375,
  MIN_ACTIVE: 50,
  MAX_ACTIVE: 2000,
  POPULATION_RATIO: 0.05,
  DESPAWN_TIMEOUT: 120,
  /** Visual multiplier: max spawned pedestrians = effective pool size × this */
  VISUAL_MULTIPLIER: 3,
  /** Minimum effective pool size — dilutes small pools so rare trip types don't dominate */
  MIN_POOL_SIZE: 100,
  /** Number of distinct pedestrian color variants */
  COLOR_COUNT: 12,
  /** Lateral offset random range (±half this value) */
  LATERAL_OFFSET_RANGE: 0.08,
  /** Minimum speed multiplier (random range: min .. min + SPEED_MULTIPLIER_RANGE) */
  SPEED_MULTIPLIER_MIN: 0.5,
  /** Speed multiplier random range added to min */
  SPEED_MULTIPLIER_RANGE: 0.5,
  /** Max retries for rejection sampling a sidewalk edge */
  EDGE_SAMPLE_RETRIES: 10,
} as const;

export const DECORATIVE_PEDESTRIAN = {
  MAX_RATIO: 0.15,
  SPAWN_INTERVAL: 8,
  BATCH_SIZE: 3,
} as const;

export function getMaxPedestrians(population: number): number {
  return Math.max(
    PEDESTRIAN.MIN_ACTIVE,
    Math.min(Math.floor(population * PEDESTRIAN.POPULATION_RATIO), PEDESTRIAN.MAX_ACTIVE),
  );
}

// ── WalkingTripPool ────────────────────────────────────────────────────

export interface AggregatedTrip {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tripType: PedestrianTripType;
  count: number;
}

export interface WalkingTripPool {
  trips: AggregatedTrip[];
  totalWeight: number;
  prefixSums: number[];
}

export function buildTripPool(trips: AggregatedTrip[]): WalkingTripPool {
  let total = 0;
  const prefixSums: number[] = [];
  for (const t of trips) {
    total += t.count;
    prefixSums.push(total);
  }
  return { trips, totalWeight: total, prefixSums };
}

export function sampleTrip(pool: WalkingTripPool, effectiveWeightOrRand?: number | (() => number), rand = Math.random): AggregatedTrip | null {
  if (pool.totalWeight === 0) return null;
  let w: number;
  if (typeof effectiveWeightOrRand === 'function') {
    rand = effectiveWeightOrRand;
    w = pool.totalWeight;
  } else {
    w = effectiveWeightOrRand ?? pool.totalWeight;
  }
  const r = rand() * w;
  // Random fell outside real pool range → diluted empty slot
  if (r >= pool.totalWeight) return null;
  // Binary search in prefix sums
  let lo = 0, hi = pool.prefixSums.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pool.prefixSums[mid]! <= r) lo = mid + 1;
    else hi = mid;
  }
  return pool.trips[lo] ?? null;
}

// ── Traffic light / level crossing interfaces ──────────────────────────

export interface TrafficLightQuery {
  canPass(fromX: number, fromY: number, toX: number, toY: number): boolean;
  getLight(x: number, y: number): { phase: number; clearing: boolean } | undefined;
}

export interface LevelCrossingQuery {
  isCrossingBlocked(x: number, y: number): boolean;
}

// ── PedestrianManager ──────────────────────────────────────────────────

/** Maximum cached paths before eviction (prevents unbounded growth). */
const MAX_PATH_CACHE = 2000;

export class PedestrianManager {
  readonly agents: PedestrianAgent[] = [];
  private nextId = 1;
  private pathCache = new Map<string, SidewalkEdge[] | null>();
  private cellIndex = new Map<string, Set<string>>();

  /** Current trip pool for continuous per-frame spawning */
  private tripPool: WalkingTripPool = { trips: [], totalWeight: 0, prefixSums: [] };
  private currentPopulation = 0;
  /** Density multiplier: 1.0 during rush, lower during off-peak */
  private densityMultiplier = 1.0;

  constructor(
    private sidewalkGraph: SidewalkGraph,
    private trafficLights: TrafficLightQuery | null = null,
    private levelCrossings: LevelCrossingQuery | null = null,
  ) {}

  spawnPedestrian(
    originX: number, originY: number,
    destX: number, destY: number,
    citizenId: number,
    tripType: PedestrianTripType,
    population = 0,
  ): number | null {
    const maxActive = population > 0 ? getMaxPedestrians(population) : PEDESTRIAN.MAX_ACTIVE;
    if (this.agents.length >= maxActive) return null;

    const path = this.getCachedPath(originX, originY, destX, destY);
    if (!path || path.length === 0) return null;

    // Start at door node (first edge, progress 0).
    // Speed multiplier randomness desynchronizes cohorts.
    const edge = path[0]!;
    const startX = edge.from.position.x;
    const startY = edge.from.position.y;

    const id = this.nextId++;
    const agent: PedestrianAgent = {
      id,
      citizenId,
      tripType,
      edgePath: path,
      edgeIndex: 0,
      edgeProgress: 0,
      position: { x: startX, y: startY },
      heading: Math.atan2(
        -(edge.to.position.y - edge.from.position.y),
        edge.to.position.x - edge.from.position.x,
      ),
      state: PedestrianState.WALKING,
      waitTimer: 0,
      colorIndex: id % PEDESTRIAN.COLOR_COUNT,
      age: 0,
      offsetX: (Math.random() - 0.5) * PEDESTRIAN.LATERAL_OFFSET_RANGE,
      offsetZ: (Math.random() - 0.5) * PEDESTRIAN.LATERAL_OFFSET_RANGE,
      speedMultiplier: PEDESTRIAN.SPEED_MULTIPLIER_MIN + Math.random() * PEDESTRIAN.SPEED_MULTIPLIER_RANGE,
    };
    this.agents.push(agent);
    return id;
  }

  /** Set the walking trip pool (called from SimulationLoop when pool is rebuilt) */
  setTripPool(pool: WalkingTripPool, population: number): void {
    this.tripPool = pool;
    this.currentPopulation = population;
  }

  /** Set density multiplier for off-peak periods (0.0–1.0) */
  setDensityMultiplier(multiplier: number): void {
    this.densityMultiplier = Math.max(0, Math.min(1, multiplier));
  }

  tick(dt: number): void {
    // Per-frame refill: continuously spawn to maintain target density
    this.refillFromPool(dt);

    // Single-pass update + compact: O(N) with no splice/shift
    let writeIdx = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i]!;

      // Remove arrived agents
      if (agent.state === PedestrianState.ARRIVED) continue;

      // Despawn timeout
      agent.age += dt;
      if (agent.age >= PEDESTRIAN.DESPAWN_TIMEOUT) continue;

      const currentEdge = agent.edgePath[agent.edgeIndex];
      if (!currentEdge) continue; // no edge → skip

      // If waiting at a blocked edge, re-check before allowing movement
      if (agent.state === PedestrianState.WAITING_SIGNAL) {
        if (this.trafficLights && !this.canPassCrosswalk(currentEdge)) {
          this.agents[writeIdx++] = agent;
          continue;
        }
        agent.state = PedestrianState.WALKING;
      }
      if (agent.state === PedestrianState.WAITING_CROSSING) {
        const cellKey = currentEdge.from.cellKey;
        const parts = cellKey.split(',');
        if (this.levelCrossings?.isCrossingBlocked(Number(parts[0]), Number(parts[1]))) {
          this.agents[writeIdx++] = agent;
          continue;
        }
        agent.state = PedestrianState.WALKING;
      }

      // Move
      const moveDistance = PEDESTRIAN.SPEED * agent.speedMultiplier * dt;
      agent.edgeProgress += moveDistance;

      // Advance through edges — check traffic lights / crossings BEFORE entering
      let edge = currentEdge;
      while (agent.edgeProgress >= edge.length) {
        const overflow = agent.edgeProgress - edge.length;
        const nextIdx = agent.edgeIndex + 1;
        if (nextIdx >= agent.edgePath.length) {
          agent.edgeProgress -= edge.length;
          agent.edgeIndex = nextIdx;
          agent.state = PedestrianState.ARRIVED;
          break;
        }
        const nextEdge = agent.edgePath[nextIdx]!;

        // Block at crosswalk if red light — only when ENTERING the intersection
        // (from non-crosswalk to crosswalk). Already inside → let them through.
        if (nextEdge.type === 'crosswalk' && edge.type !== 'crosswalk'
            && this.trafficLights && !this.canPassCrosswalk(nextEdge)) {
          agent.edgeProgress = edge.length; // stop at end of current edge
          agent.state = PedestrianState.WAITING_SIGNAL;
          break;
        }

        // Block at level crossing if train passing
        if (nextEdge.type === 'level_crossing' && this.levelCrossings) {
          const cellKey = nextEdge.from.cellKey;
          const parts = cellKey.split(',');
          if (this.levelCrossings.isCrossingBlocked(Number(parts[0]), Number(parts[1]))) {
            agent.edgeProgress = edge.length;
            agent.state = PedestrianState.WAITING_CROSSING;
            break;
          }
        }

        // Safe to enter next edge
        agent.edgeProgress = overflow;
        agent.edgeIndex = nextIdx;
        edge = nextEdge;
      }

      if (agent.state === PedestrianState.ARRIVED) continue;

      // Interpolate position
      const t = edge.length > 0 ? agent.edgeProgress / edge.length : 0;
      agent.position.x = edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t;
      agent.position.y = edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t;
      const targetHeading = Math.atan2(
        -(edge.to.position.y - edge.from.position.y),
        edge.to.position.x - edge.from.position.x,
      );
      // Smooth heading transition to avoid visual snap
      const diff = ((targetHeading - agent.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      agent.heading += diff * Math.min(1, dt * 8);

      this.agents[writeIdx++] = agent;
    }
    this.agents.length = writeIdx; // compact: truncate removed agents
  }

  getPedestrians(): ReadonlyArray<PedestrianAgent> {
    return this.agents;
  }

  getActiveCount(): number {
    return this.agents.length;
  }

  spawnDecorativeBatch(population: number): void {
    const maxDecorative = Math.floor(getMaxPedestrians(population) * DECORATIVE_PEDESTRIAN.MAX_RATIO);
    // Count decorative pedestrians inline (no filter array)
    let currentDecorative = 0;
    for (const a of this.agents) {
      if (a.tripType === PedestrianTripType.DECORATIVE) currentDecorative++;
    }
    if (currentDecorative >= maxDecorative) return;

    const allEdges = this.sidewalkGraph.getAllEdges();
    if (allEdges.length === 0) return;

    const count = Math.min(DECORATIVE_PEDESTRIAN.BATCH_SIZE, maxDecorative - currentDecorative);
    for (let i = 0; i < count; i++) {
      // Pick a random sidewalk edge (skip crosswalks via rejection sampling)
      let edge = allEdges[Math.floor(Math.random() * allEdges.length)]!;
      let retries = PEDESTRIAN.EDGE_SAMPLE_RETRIES;
      while (edge.type !== 'sidewalk' && retries-- > 0) {
        edge = allEdges[Math.floor(Math.random() * allEdges.length)]!;
      }
      if (edge.type !== 'sidewalk') continue;
      const maxActive = getMaxPedestrians(population);
      if (this.agents.length >= maxActive) break;

      const id = this.nextId++;
      const agent: PedestrianAgent = {
        id,
        citizenId: -1,
        tripType: PedestrianTripType.DECORATIVE,
        edgePath: [edge],
        edgeIndex: 0,
        edgeProgress: 0,
        position: { x: edge.from.position.x, y: edge.from.position.y },
        heading: 0,
        state: PedestrianState.WALKING,
        waitTimer: 0,
        colorIndex: id % PEDESTRIAN.COLOR_COUNT,
        age: 0,
        offsetX: (Math.random() - 0.5) * PEDESTRIAN.LATERAL_OFFSET_RANGE,
        offsetZ: (Math.random() - 0.5) * PEDESTRIAN.LATERAL_OFFSET_RANGE,
        speedMultiplier: PEDESTRIAN.SPEED_MULTIPLIER_MIN + Math.random() * PEDESTRIAN.SPEED_MULTIPLIER_RANGE,
      };
      this.agents.push(agent);
    }
  }

  // ── Per-frame refill ──

  private spawnAccumulator = 0;

  private refillFromPool(dt: number): void {
    if (this.tripPool.totalWeight === 0 || this.currentPopulation === 0) return;

    const effectiveWeight = Math.max(this.tripPool.totalWeight, PEDESTRIAN.MIN_POOL_SIZE);
    const hardCap = Math.floor(getMaxPedestrians(this.currentPopulation) * this.densityMultiplier);
    const targetPed = Math.min(hardCap, effectiveWeight * PEDESTRIAN.VISUAL_MULTIPLIER);
    const deficit = targetPed - this.agents.length;
    if (deficit <= 0) return;

    // Target spawn rate: fill deficit over ~1 second
    // This ensures rapid refill when many pedestrians despawn at once
    const spawnRate = deficit;
    this.spawnAccumulator += spawnRate * dt;
    const toSpawn = Math.floor(this.spawnAccumulator);
    this.spawnAccumulator -= toSpawn;

    for (let i = 0; i < toSpawn; i++) {
      if (this.agents.length >= targetPed) break;
      const trip = sampleTrip(this.tripPool, effectiveWeight);
      if (!trip) continue; // diluted empty slot — skip, don't break
      this.spawnPedestrian(
        trip.fromX, trip.fromY,
        trip.toX, trip.toY,
        -1,
        trip.tripType,
        this.currentPopulation,
      );
    }
  }

  // ── Path cache ──

  /**
   * Point the manager at a rebuilt sidewalk graph without discarding its agents.
   * The path cache is graph-derived and must go; the pedestrians themselves are
   * simulation state (BUG-104).
   */
  setSidewalkGraph(graph: SidewalkGraph): void {
    this.sidewalkGraph = graph;
    this.clearPathCache();
  }

  /**
   * Retire pedestrians whose remaining route crosses any of the given cells.
   *
   * The mirror of TrafficSimulation.markVehiclesArrivedOnCells. Keeping agents
   * across a rebuild (BUG-104) stopped them vanishing, but buildFromGrid
   * replaces every node and edge — an agent's edgePath then points at objects
   * that no longer describe anything, and tick() never re-queries the graph. So
   * they walked demolished pavement, across grass, into doorways of razed
   * buildings, for up to DESPAWN_TIMEOUT. Pedestrians have no stallTime to save
   * them either (BUG-124).
   */
  /**
   * Retire every walking agent, whatever pavement it is on.
   *
   * The counterpart of TrafficSimulation.markCommuteVehiclesArrived, for a FULL
   * sidewalk-graph rebuild where every edge object is replaced and there is no
   * removed-cell set to scope by.
   */
  markAllAgentsArrived(): number {
    let count = 0;
    for (const agent of this.agents) {
      if (agent.edgePath.length === 0) continue;
      agent.state = PedestrianState.ARRIVED;
      count++;
    }
    return count;
  }

  markAgentsArrivedOnCells(cellKeys: ReadonlySet<string>): number {
    let count = 0;
    for (const agent of this.agents) {
      if (agent.edgePath.length === 0) continue;
      for (let i = agent.edgeIndex; i < agent.edgePath.length; i++) {
        const e = agent.edgePath[i]!;
        if (cellKeys.has(e.from.cellKey) || cellKeys.has(e.to.cellKey)) {
          agent.state = PedestrianState.ARRIVED;
          count++;
          break;
        }
      }
    }
    return count;
  }

  /**
   * Wire up level-crossing queries. The blocking logic was fully implemented and
   * unit-tested, but nothing ever supplied a lookup, so pedestrians walked
   * through closed railway barriers and PedestrianState.WAITING_CROSSING was
   * unreachable (BUG-105).
   */
  setLevelCrossings(crossings: LevelCrossingQuery | null): void {
    this.levelCrossings = crossings;
  }

  invalidateCells(affectedCells: Iterable<string>): void {
    for (const cellKey of affectedCells) {
      const pathKeys = this.cellIndex.get(cellKey);
      if (!pathKeys) continue;
      for (const pathKey of pathKeys) {
        this.pathCache.delete(pathKey);
      }
      this.cellIndex.delete(cellKey);
    }
  }

  clearPathCache(): void {
    this.pathCache.clear();
    this.cellIndex.clear();
  }

  // ── Serialization ──

  toJSON(): { agents: PedestrianAgent[]; nextId: number } {
    return { agents: [...this.agents], nextId: this.nextId };
  }

  fromJSON(data: { agents: PedestrianAgent[]; nextId: number }): void {
    this.agents.length = 0;
    for (const a of data.agents) this.agents.push(a);
    this.nextId = data.nextId;
  }

  // ── Private ──

  private getCachedPath(
    fromX: number, fromY: number, toX: number, toY: number,
  ): SidewalkEdge[] | null {
    const key = `${fromX},${fromY}→${toX},${toY}`;
    if (this.pathCache.has(key)) {
      return this.pathCache.get(key) ?? null;
    }

    // Evict entire cache when it grows too large (prevents unbounded memory growth)
    if (this.pathCache.size >= MAX_PATH_CACHE) {
      this.clearPathCache();
    }

    // Try building-aware pathfinding: origin = random door, dest = multi-target (all doors)
    const path = this.findBuildingAwarePath(fromX, fromY, toX, toY);
    this.pathCache.set(key, path);

    // Build cell index.
    //
    // A failed lookup caches `null`, and a null entry has no edges to index —
    // so invalidateCells could never reach it and the "no route" answer outlived
    // the road that would have created one. That was masked while every graph
    // change threw the whole manager away; now that the instance survives
    // (BUG-104), the endpoints must be indexed explicitly (BUG-103).
    if (path) {
      for (const edge of path) {
        const cellKey = edge.from.cellKey;
        if (!this.cellIndex.has(cellKey)) this.cellIndex.set(cellKey, new Set());
        this.cellIndex.get(cellKey)!.add(key);
      }
    } else {
      for (const cellKey of [toPosKey(fromX, fromY), toPosKey(toX, toY)]) {
        if (!this.cellIndex.has(cellKey)) this.cellIndex.set(cellKey, new Set());
        this.cellIndex.get(cellKey)!.add(key);
      }
    }

    return path;
  }

  /**
   * Find path using building topology when available.
   * Origin: random building_entrance node (or nearest sidewalk node).
   * Destination: multi-target A* to all building_entrance nodes (or nearest sidewalk node).
   */
  private findBuildingAwarePath(
    fromX: number, fromY: number, toX: number, toY: number,
  ): SidewalkEdge[] | null {
    // Resolve origin: building entrance (random) or nearest sidewalk node
    const fromNodeId = this.resolveOriginNode(fromX, fromY);
    if (!fromNodeId) return null;

    // Resolve destination: all building entrances or single nearest node
    const toNodeIds = this.resolveDestinationNodes(toX, toY);
    if (toNodeIds.length === 0) return null;

    return this.sidewalkGraph.findPathMultiTarget(fromNodeId, toNodeIds);
  }

  private resolveOriginNode(x: number, y: number): string | null {
    const cellKey = `${x},${y}`;
    const entrances = this.getBuildingEntrances(cellKey);
    if (entrances.length > 0) {
      return entrances[Math.floor(Math.random() * entrances.length)]!;
    }
    // Fallback: nearest sidewalk node (for non-building origins like transit stops)
    const node = this.sidewalkGraph.findNearestNode(x, y);
    return node?.id ?? null;
  }

  private resolveDestinationNodes(x: number, y: number): string[] {
    const cellKey = `${x},${y}`;
    const entrances = this.getBuildingEntrances(cellKey);
    if (entrances.length > 0) return entrances;
    // Fallback: single nearest node
    const node = this.sidewalkGraph.findNearestNode(x, y);
    return node ? [node.id] : [];
  }

  private getBuildingEntrances(cellKey: string): string[] {
    const nodes = this.sidewalkGraph.getNodesInCell(cellKey);
    const entrances: string[] = [];
    for (const n of nodes) {
      if (n.type === 'building_entrance') entrances.push(n.id);
    }
    return entrances;
  }

  private canPassCrosswalk(edge: SidewalkEdge): boolean {
    if (!this.trafficLights) return true;
    if (!edge.intersectionCellKey) return true;
    const iPos = edge.intersectionCellKey.split(',');
    const light = this.trafficLights.getLight(Number(iPos[0]), Number(iPos[1]));
    if (!light) return true;
    if (light.clearing) return false;
    // Pedestrians cross perpendicular to traffic.
    // Determine approach direction: from cell → intersection cell
    const fromPos = edge.from.cellKey.split(',');
    const dx = Number(iPos[0]) - Number(fromPos[0]);
    const dy = Number(iPos[1]) - Number(fromPos[1]);
    const isNS = dy !== 0;
    // N-S approach → crosswalk crosses N-S road → safe when N-S stopped (phase 1)
    // E-W approach → crosswalk crosses E-W road → safe when E-W stopped (phase 0)
    return isNS ? light.phase === 1 : light.phase === 0;
  }
}

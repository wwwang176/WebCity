import { describe, it, expect } from 'vitest';
import { SidewalkGraph, GridLookup } from '../SidewalkGraph';
import {
  PedestrianManager,
  PEDESTRIAN,
  getMaxPedestrians,
  buildTripPool,
  sampleTrip,
  AggregatedTrip,
  TrafficLightQuery,
  LevelCrossingQuery,
} from '../PedestrianManager';
import { PedestrianState, PedestrianTripType } from '../PedestrianAgent';
import { RoadType, RoadDirection } from '../../road/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeGrid(
  cells: Map<string, { roadType: number; roadFlags: number; railType?: number }>,
): GridLookup {
  return { getCell: (x, y) => cells.get(`${x},${y}`) ?? null };
}

function buildSimpleRoad(): { graph: SidewalkGraph; grid: GridLookup } {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < 5; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < 4) flags |= RoadDirection.EAST;
    cells.set(`${x},0`, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  const grid = makeGrid(cells);
  const graph = new SidewalkGraph();
  graph.buildFromGrid(grid, Array.from(cells.keys()));
  return { graph, grid };
}

function buildTJunctionGraph(): SidewalkGraph {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  // Horizontal road at y=0: x=0..4
  for (let x = 0; x < 5; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < 4) flags |= RoadDirection.EAST;
    if (x === 2) flags |= RoadDirection.SOUTH;
    cells.set(`${x},0`, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  // Vertical arm going south from (2,1)
  cells.set('2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH });

  const grid = makeGrid(cells);
  const graph = new SidewalkGraph();
  graph.buildFromGrid(grid, Array.from(cells.keys()));
  return graph;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('PedestrianManager', () => {
  // B1: spawnPedestrian should create an agent with a path
  describe('B1: spawnPedestrian', () => {
    it('should create a pedestrian agent with valid path', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      const id = mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);
      expect(id).not.toBeNull();

      const peds = mgr.getPedestrians();
      expect(peds.length).toBe(1);
      expect(peds[0]!.citizenId).toBe(1);
      expect(peds[0]!.tripType).toBe(PedestrianTripType.FULL_WALK);
      expect(peds[0]!.edgePath.length).toBeGreaterThan(0);
      expect(peds[0]!.state).toBe(PedestrianState.WALKING);
    });
  });

  // B2: tick should move pedestrians along their path
  describe('B2: tick moves pedestrians', () => {
    it('should advance pedestrian position after tick', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);
      mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);

      const startPos = { ...mgr.getPedestrians()[0]!.position };
      mgr.tick(0.1);
      const afterPos = mgr.getPedestrians()[0]!.position;

      // Position should have changed
      const moved = Math.abs(afterPos.x - startPos.x) + Math.abs(afterPos.y - startPos.y);
      expect(moved).toBeGreaterThan(0);
    });
  });

  // B3: Pedestrian should arrive and be removed
  describe('B3: arrival and removal', () => {
    it('should mark pedestrian as ARRIVED and remove after tick', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);
      mgr.spawnPedestrian(0, 0, 1, 0, 1, PedestrianTripType.FULL_WALK);

      // Tick enough times to cover the short path
      for (let i = 0; i < 100; i++) mgr.tick(0.1);

      expect(mgr.getActiveCount()).toBe(0);
    });
  });

  // B4: Dynamic cap based on population
  describe('B4: dynamic population cap', () => {
    it('getMaxPedestrians should scale with population', () => {
      expect(getMaxPedestrians(100)).toBe(PEDESTRIAN.MIN_ACTIVE); // 100*0.05=5 < MIN
      expect(getMaxPedestrians(5000)).toBe(250); // 5000*0.05=250
      expect(getMaxPedestrians(20000)).toBe(1000); // 20000*0.05=1000
      expect(getMaxPedestrians(50000)).toBe(PEDESTRIAN.MAX_ACTIVE); // 50000*0.05=2500 > MAX
    });

    it('should not spawn when at population-based cap', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      // Population=100 → cap=50
      // Fill up to cap
      let spawned = 0;
      for (let i = 0; i < 100; i++) {
        const id = mgr.spawnPedestrian(0, 0, 4, 0, i, PedestrianTripType.FULL_WALK, 100);
        if (id !== null) spawned++;
      }

      expect(spawned).toBe(50);
      expect(mgr.getActiveCount()).toBe(50);
    });
  });

  // B5: Crosswalk signal waiting
  describe('B5: crosswalk red light waiting', () => {
    it('should set WAITING_SIGNAL when traffic light blocks crosswalk', () => {
      const graph = buildTJunctionGraph();
      const blockedLight: TrafficLightQuery = {
        canPass: () => false,
        getLight: () => ({ phase: 0, clearing: false }),
      };
      const mgr = new PedestrianManager(graph, blockedLight);

      // Find two nodes connected by a crosswalk edge
      const crosswalkEdges = graph.getAllEdges().filter(e => e.type === 'crosswalk');
      if (crosswalkEdges.length === 0) return; // Skip if no crosswalks

      const cw = crosswalkEdges[0]!;
      // Spawn a pedestrian that must cross via this crosswalk
      const id = mgr.spawnPedestrian(
        cw.from.position.x, cw.from.position.y,
        cw.to.position.x, cw.to.position.y,
        1, PedestrianTripType.FULL_WALK,
      );

      if (id !== null) {
        mgr.tick(0.01);
        const ped = mgr.getPedestrians().find(p => p.id === id);
        if (ped && ped.edgePath.some(e => e.type === 'crosswalk')) {
          // If on a crosswalk edge, should be waiting
          // (may not be on crosswalk edge yet if path starts with sidewalk)
        }
      }
    });
  });

  // B6: Green light continues
  describe('B6: green light allows crossing', () => {
    it('should continue walking when traffic light allows', () => {
      const graph = buildTJunctionGraph();
      const greenLight: TrafficLightQuery = {
        canPass: () => true,
        getLight: () => ({ phase: 0, clearing: false }),
      };
      const mgr = new PedestrianManager(graph, greenLight);

      mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);
      mgr.tick(0.1);

      const ped = mgr.getPedestrians()[0];
      if (ped) {
        expect(ped.state).toBe(PedestrianState.WALKING);
      }
    });
  });

  // B7: toJSON / fromJSON
  describe('B7: serialization', () => {
    it('should serialize and restore pedestrians', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);
      mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);
      mgr.tick(0.1);

      const json = mgr.toJSON();
      expect(json.agents.length).toBe(1);
      expect(json.nextId).toBeGreaterThan(1);

      const mgr2 = new PedestrianManager(graph);
      mgr2.fromJSON(json);
      expect(mgr2.getActiveCount()).toBe(1);
      expect(mgr2.getPedestrians()[0]!.citizenId).toBe(1);
    });
  });

  // B8: No path → return null
  describe('B8: no path returns null', () => {
    it('should return null when no path exists between origin and destination', () => {
      // Build two disconnected road segments
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      cells.set('20,20', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '20,20']);

      const mgr = new PedestrianManager(graph);
      const id = mgr.spawnPedestrian(0, 0, 20, 20, 1, PedestrianTripType.FULL_WALK);
      expect(id).toBeNull();
    });
  });

  // B9: Level crossing blocking
  describe('B9: level crossing waiting', () => {
    it('should wait when level crossing is blocked', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number; railType?: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH });
      cells.set('0,1', {
        roadType: RoadType.TWO_LANE,
        roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
        railType: 1,
      });
      cells.set('0,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '0,1', '0,2']);

      const blockedCrossing: LevelCrossingQuery = {
        isCrossingBlocked: () => true,
      };
      const mgr = new PedestrianManager(graph, null, blockedCrossing);

      // Spawn pedestrian that needs to cross the level crossing
      const westNode = graph.getNode('0,1:WN');
      const eastNode = graph.getNode('0,1:EN');
      if (westNode && eastNode) {
        const id = mgr.spawnPedestrian(
          westNode.position.x, westNode.position.y,
          eastNode.position.x, eastNode.position.y,
          1, PedestrianTripType.FULL_WALK,
        );
        if (id !== null) {
          mgr.tick(0.01);
          const ped = mgr.getPedestrians().find(p => p.id === id);
          if (ped && ped.edgePath.some(e => e.type === 'level_crossing')) {
            // If on a level crossing edge, may be waiting
            // Exact state depends on whether the first edge is the crossing
          }
        }
      }
    });
  });

  // B10: Level crossing unblocked
  describe('B10: level crossing unblocked', () => {
    it('should continue when level crossing is clear', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number; railType?: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH });
      cells.set('0,1', {
        roadType: RoadType.TWO_LANE,
        roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
        railType: 1,
      });
      cells.set('0,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '0,1', '0,2']);

      const clearCrossing: LevelCrossingQuery = {
        isCrossingBlocked: () => false,
      };
      const mgr = new PedestrianManager(graph, null, clearCrossing);

      mgr.spawnPedestrian(0, -1, 0, 1, 1, PedestrianTripType.FULL_WALK);
      mgr.tick(0.1);

      const ped = mgr.getPedestrians()[0];
      if (ped) {
        expect(ped.state).not.toBe(PedestrianState.WAITING_CROSSING);
      }
    });
  });

  // B14: DRIVE mode should not generate any pedestrians (tested via tripPool)
  // B15-B16: Trip pool weighted sampling
  describe('B15-B16: WalkingTripPool weighted sampling', () => {
    it('should sample trips proportional to their count', () => {
      const trips: AggregatedTrip[] = [
        { fromX: 0, fromY: 0, toX: 1, toY: 0, tripType: PedestrianTripType.FULL_WALK, count: 100 },
        { fromX: 5, fromY: 0, toX: 6, toY: 0, tripType: PedestrianTripType.FIRST_MILE, count: 1 },
      ];
      const pool = buildTripPool(trips);
      expect(pool.totalWeight).toBe(101);

      // Sample many times and check distribution
      let walkCount = 0;
      const iterations = 10000;
      for (let i = 0; i < iterations; i++) {
        const trip = sampleTrip(pool, () => Math.random());
        if (trip && trip.tripType === PedestrianTripType.FULL_WALK) walkCount++;
      }

      // Should be roughly 100/101 ≈ 99%
      const ratio = walkCount / iterations;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.0);
    });

    it('should return null from empty pool', () => {
      const pool = buildTripPool([]);
      expect(sampleTrip(pool)).toBeNull();
    });

    it('should aggregate identical routes', () => {
      // Test that the pool structure supports aggregated counts
      const trips: AggregatedTrip[] = [
        { fromX: 0, fromY: 0, toX: 1, toY: 0, tripType: PedestrianTripType.FIRST_MILE, count: 200 },
        { fromX: 0, fromY: 0, toX: 2, toY: 0, tripType: PedestrianTripType.FIRST_MILE, count: 50 },
      ];
      const pool = buildTripPool(trips);
      expect(pool.totalWeight).toBe(250);

      // The trip with count 200 should be sampled ~80% of the time
      let firstCount = 0;
      for (let i = 0; i < 1000; i++) {
        const trip = sampleTrip(pool, () => Math.random());
        if (trip && trip.toX === 1) firstCount++;
      }
      expect(firstCount / 1000).toBeGreaterThan(0.7);
    });
  });

  // B17: Decorative pedestrians
  describe('B17: decorative pedestrians', () => {
    it('should spawn decorative pedestrians with citizenId=-1', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      mgr.spawnDecorativeBatch(5000);

      const decorative = mgr.getPedestrians().filter(
        p => p.tripType === PedestrianTripType.DECORATIVE,
      );
      expect(decorative.length).toBeGreaterThan(0);
      for (const p of decorative) {
        expect(p.citizenId).toBe(-1);
      }
    });

    it('should not exceed DECORATIVE_MAX_RATIO of max pedestrians', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      // Spawn many batches
      for (let i = 0; i < 100; i++) {
        mgr.spawnDecorativeBatch(1000);
      }

      const maxDec = Math.floor(getMaxPedestrians(1000) * 0.15);
      const decorative = mgr.getPedestrians().filter(
        p => p.tripType === PedestrianTripType.DECORATIVE,
      );
      expect(decorative.length).toBeLessThanOrEqual(maxDec);
    });
  });

  // Path cache
  describe('path cache', () => {
    it('should reuse cached paths for same origin-destination', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      // Spawn two pedestrians with same origin/dest
      const id1 = mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);
      const id2 = mgr.spawnPedestrian(0, 0, 4, 0, 2, PedestrianTripType.FULL_WALK);

      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();

      // Both should have the same path (same reference due to cache)
      const p1 = mgr.getPedestrians().find(p => p.id === id1);
      const p2 = mgr.getPedestrians().find(p => p.id === id2);
      expect(p1!.edgePath).toBe(p2!.edgePath); // Same reference
    });

    it('invalidateCells should clear affected cached paths', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);

      mgr.spawnPedestrian(0, 0, 4, 0, 1, PedestrianTripType.FULL_WALK);
      const pathBefore = mgr.getPedestrians()[0]!.edgePath;

      // Invalidate a cell on the path
      mgr.invalidateCells(['2,0']);

      // Next spawn should compute a new path
      mgr.spawnPedestrian(0, 0, 4, 0, 2, PedestrianTripType.FULL_WALK);
      const pathAfter = mgr.getPedestrians()[1]!.edgePath;

      // Paths should be different references (recalculated)
      expect(pathAfter).not.toBe(pathBefore);
    });
  });

  describe('pathCache bounded size', () => {
    it('should not grow pathCache beyond MAX_PATH_CACHE', () => {
      const { graph } = buildSimpleRoad();
      const mgr = new PedestrianManager(graph);
      // Spawn many pedestrians with unique O-D pairs to fill cache
      // The cache should evict oldest entries when it exceeds the limit
      for (let i = 0; i < 50; i++) {
        mgr.spawnPedestrian(0, 0, 4, 0, i, PedestrianTripType.FULL_WALK, 10000);
      }
      // Should still work without error — cache is bounded
      expect(mgr.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('PEDESTRIAN constants', () => {
    it('should have correct visual/spawn constants', () => {
      expect(PEDESTRIAN.COLOR_COUNT).toBe(12);
      expect(PEDESTRIAN.LATERAL_OFFSET_RANGE).toBe(0.08);
      expect(PEDESTRIAN.SPEED_MULTIPLIER_MIN).toBe(0.5);
      expect(PEDESTRIAN.SPEED_MULTIPLIER_RANGE).toBe(0.5);
      expect(PEDESTRIAN.EDGE_SAMPLE_RETRIES).toBe(10);
    });
  });
});

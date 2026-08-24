import { describe, it, expect } from 'vitest';
import {
  computeCongestionFlow,
  computeCongestionFlowMonteCarlo,
  type CongestionFlowDeps,
} from '../CongestionFlowPredictor';
import { CommuteCache } from '../CommuteCache';
import { PathCellCache } from '../PathCellCache';
import type { LaneEdge } from '../LaneGraph';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

function makeEdge(fromKey: string, toKey: string, via?: string): LaneEdge {
  return makeCellEdge(fromKey, toKey, 0, { length: 1, ...(via ? { viaCellKey: via } : {}) });
}

describe('CongestionFlowPredictor', () => {
  describe('computeCongestionFlow', () => {
    it('returns empty map when commuteCache has no routes', () => {
      const cache = new CommuteCache();
      const { flowMap, totalRefCount } = computeCongestionFlow(cache, new PathCellCache(), () => 1);
      expect(flowMap.size).toBe(0);
      expect(totalRefCount).toBe(0);
    });

    it('accumulates flow from cached routes weighted by refCount', () => {
      const cache = new CommuteCache();

      // Simulate a route with 2 variants used by 10 citizens
      // We need to set up the internal routeIndex + routeRefCount
      // by going through the public API: setRouteVariants then set citizen routes
      const edgeAB = makeEdge('0,0', '1,0');
      const edgeBC = makeEdge('1,0', '2,0');
      const path1 = [edgeAB, edgeBC];

      cache.setRouteVariants('0,0->2,0', [path1]);

      // Add 4 citizens using this route
      for (let i = 0; i < 4; i++) {
        cache.set(i, {
          citizenId: i,
          homeId: '0,0',
          workplaceId: '2,0',
          morningPath: path1,
          eveningPath: null,
          status: 'ready',
          generation: 0,
        });
      }

      const { flowMap, totalRefCount } = computeCongestionFlow(cache, new PathCellCache(), () => 1);

      // All 3 cells should have flow
      expect(flowMap.has('0,0')).toBe(true);
      expect(flowMap.has('1,0')).toBe(true);
      expect(flowMap.has('2,0')).toBe(true);
      // totalRefCount = sum of refCounts (4 citizens)
      expect(totalRefCount).toBe(4);
    });

    it('normalizes flow by lane count', () => {
      const cache = new CommuteCache();
      const path = [makeEdge('0,0', '1,0')];
      // routeKey must match the pattern homeId->workplaceId used by adjustRefCounts
      cache.setRouteVariants('0,0->1,0', [path]);
      cache.set(0, {
        citizenId: 0,
        homeId: '0,0',
        workplaceId: '1,0',
        morningPath: path,
        eveningPath: null,
        status: 'ready',
        generation: 0,
      });

      // 2-lane road: flow should be halved
      const { flowMap } = computeCongestionFlow(cache, new PathCellCache(), (cellKey) => {
        return cellKey === '0,0' ? 2 : 1;
      });

      const flowAt00 = flowMap.get('0,0') ?? 0;
      const flowAt10 = flowMap.get('1,0') ?? 0;
      // 0,0 has 2 lanes, so its normalized flow should be half of 1,0's
      expect(flowAt00).toBeLessThan(flowAt10);
    });

    it('should build the map from what the cell cache says', () => {
      // Pins that the flow map really accumulates over the cells the cache hands back. Going
      // back to rebuilding a Set from the edges each time produces identical output, so no
      // result-checking assertion would fail.
      class Poisoned extends PathCellCache {
        override cellsOf(): readonly string[] { return ['poison,0']; }
      }
      const cache = new CommuteCache();
      const path = [makeEdge('5,5', '6,5')];
      cache.setRouteVariants('5,5->6,5', [path]);
      cache.set(0, {
        citizenId: 0, homeId: '5,5', workplaceId: '6,5',
        morningPath: path, eveningPath: null, status: 'ready', generation: 0,
      });

      const { flowMap } = computeCongestionFlow(cache, new Poisoned(), () => 1);
      expect(flowMap.has('poison,0'), '流量圖沒有照快取給的格子走').toBe(true);
      expect(flowMap.has('5,5'), '繞過快取自己從邊重建了一份').toBe(false);
    });

    it('should weight each cell by how many people use the route', () => {
      // The flow map asks how many citizens' commutes cross a cell. Counting one per route
      // makes an empty side street as congested as an arterial the whole city uses, and the
      // assertions that only check `flowMap.has(...)` would not catch it.
      const busy = new CommuteCache();
      const quiet = new CommuteCache();
      const path = [makeEdge('0,0', '1,0')];
      for (const [cache, riders] of [[busy, 40], [quiet, 1]] as const) {
        cache.setRouteVariants('0,0->1,0', [path]);
        for (let i = 0; i < riders; i++) {
          cache.set(i, {
            citizenId: i, homeId: '0,0', workplaceId: '1,0',
            morningPath: path, eveningPath: null, status: 'ready', generation: 0,
          });
        }
      }
      const flowOf = (c: CommuteCache) =>
        computeCongestionFlow(c, new PathCellCache(), () => 1).flowMap.get('0,0') ?? 0;

      expect(flowOf(busy), '四十個人走的路跟一個人走的路一樣空')
        .toBeGreaterThan(flowOf(quiet) * 10);
    });

    it('should give the same answer on a second pass', () => {
      // The cache is shared across passes. A second pass reading dirtied content — mutated in
      // place, say — makes the congestion overlay flicker every 15 seconds.
      const cache = new CommuteCache();
      const path = [makeEdge('1,1', '2,1'), makeEdge('2,1', '3,1')];
      cache.setRouteVariants('1,1->3,1', [path]);
      cache.set(0, {
        citizenId: 0, homeId: '1,1', workplaceId: '3,1',
        morningPath: path, eveningPath: null, status: 'ready', generation: 0,
      });

      const cells = new PathCellCache();
      const first = computeCongestionFlow(cache, cells, () => 1).flowMap;
      const second = computeCongestionFlow(cache, cells, () => 1).flowMap;
      expect([...second.entries()].sort(), '第二次算出來不一樣')
        .toEqual([...first.entries()].sort());
    });
  });

  describe('computeCongestionFlowMonteCarlo', () => {
    it('returns empty map when no valid OD pairs exist', () => {
      const deps: CongestionFlowDeps = {
        citizens: [],
        parsePosKey: (k) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        },
        findLanePath: () => null,
        getAvailableTransit: () => [],
        chooseTransportMode: () => 'DRIVE' as any,
      };

      const result = computeCongestionFlowMonteCarlo(deps, 50, 300, 5);
      expect(result.size).toBe(0);
    });

    it('accumulates flow from sampled commute routes', () => {
      // Working age is >52 and <=200
      const citizens = [
        { age: 60, homeId: '0,0', workplaceId: '10,10' },
        { age: 70, homeId: '0,0', workplaceId: '10,10' },
        { age: 80, homeId: '1,1', workplaceId: '11,11' },
      ];

      const edgePath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];

      const deps: CongestionFlowDeps = {
        citizens,
        parsePosKey: (k) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        },
        findLanePath: () => edgePath,
        getAvailableTransit: () => [],
        chooseTransportMode: () => 'DRIVE' as any,
      };

      const result = computeCongestionFlowMonteCarlo(deps, 5, 20, 5);

      // Should have accumulated flow on edge cells
      // The exact values depend on sampling, but cells should be non-empty
      expect(result.size).toBeGreaterThan(0);
    });

    it('skips non-DRIVE transport modes', () => {
      const citizens = [
        { age: 60, homeId: '0,0', workplaceId: '10,10' },
        { age: 70, homeId: '0,0', workplaceId: '10,10' },
      ];

      const deps: CongestionFlowDeps = {
        citizens,
        parsePosKey: (k) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        },
        findLanePath: () => [makeEdge('0,0', '1,0')],
        getAvailableTransit: () => [],
        // Always choose BUS — no drive traffic
        chooseTransportMode: () => 'BUS' as any,
      };

      const result = computeCongestionFlowMonteCarlo(deps, 5, 20, 5);
      expect(result.size).toBe(0);
    });

    it('scales flow proportionally to total commuters', () => {
      // More citizens = higher scaled flow
      const makeCitizens = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          age: 60,
          homeId: '0,0',
          workplaceId: `${10 + (i % 3)},${10 + (i % 3)}`,
        }));

      const edgePath = [makeEdge('0,0', '1,0')];

      const makeDeps = (citizens: any[]): CongestionFlowDeps => ({
        citizens,
        parsePosKey: (k) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        },
        findLanePath: () => edgePath,
        getAvailableTransit: () => [],
        chooseTransportMode: () => 'DRIVE' as any,
      });

      const smallResult = computeCongestionFlowMonteCarlo(makeDeps(makeCitizens(10)), 5, 20, 5);
      const largeResult = computeCongestionFlowMonteCarlo(makeDeps(makeCitizens(100)), 5, 20, 5);

      const smallFlow = smallResult.get('0,0') ?? 0;
      const largeFlow = largeResult.get('0,0') ?? 0;

      // Larger population should produce higher scaled flow
      expect(largeFlow).toBeGreaterThan(smallFlow);
    });

    it('skips trips where origin equals destination', () => {
      const citizens = [
        { age: 60, homeId: '5,5', workplaceId: '5,5' },
      ];

      const deps: CongestionFlowDeps = {
        citizens,
        parsePosKey: (k) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        },
        findLanePath: () => [makeEdge('5,5', '6,5')],
        getAvailableTransit: () => [],
        chooseTransportMode: () => 'DRIVE' as any,
      };

      const result = computeCongestionFlowMonteCarlo(deps, 5, 20, 5);
      expect(result.size).toBe(0);
    });
  });
});

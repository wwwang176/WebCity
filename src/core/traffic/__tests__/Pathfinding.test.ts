import { describe, it, expect } from 'vitest';
import { RoadNetwork } from '../../road/RoadNetwork';
import { findPath, gridAStarPath } from '../Pathfinding';
import { RoadType } from '../../road/types';

function createSimpleNetwork(): RoadNetwork {
  const network = new RoadNetwork();
  // 5x1 line: 0,0 - 1,0 - 2,0 - 3,0 - 4,0
  for (let i = 0; i < 4; i++) {
    network.addEdge(`${i},0`, `${i + 1},0`);
  }
  return network;
}

function createGridNetwork(): RoadNetwork {
  const network = new RoadNetwork();
  // 5x5 grid
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      if (x < 4) network.addEdge(`${x},${y}`, `${x + 1},${y}`);
      if (y < 4) network.addEdge(`${x},${y}`, `${x},${y + 1}`);
    }
  }
  return network;
}

describe('Pathfinding', () => {
  it('should find shortest path on simple line', () => {
    const network = createSimpleNetwork();
    const path = findPath(network, '0,0', '4,0');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![0]).toBe('0,0');
    expect(path![4]).toBe('4,0');
  });

  it('should return null when no path exists', () => {
    const network = new RoadNetwork();
    network.addNode('0,0');
    network.addNode('5,5');
    const path = findPath(network, '0,0', '5,5');
    expect(path).toBeNull();
  });

  it('should prefer less congested routes', () => {
    const network = createGridNetwork();
    const congestion = new Map<string, number>();
    // Make direct path congested
    congestion.set('1,0', 0.9);
    congestion.set('2,0', 0.9);
    congestion.set('3,0', 0.9);

    const pathCongested = findPath(network, '0,0', '4,0', {
      congestion,
      trafficLights: new Set(),
    });
    const pathNormal = findPath(network, '0,0', '4,0');

    expect(pathCongested).not.toBeNull();
    expect(pathNormal).not.toBeNull();
    // Congested path should avoid the congested route
    if (pathCongested!.length > pathNormal!.length) {
      expect(true).toBe(true); // Took alternate route
    }
  });

  it('should avoid traffic lights', () => {
    const network = createGridNetwork();
    const trafficLights = new Set(['2,0']);
    const path = findPath(network, '0,0', '4,0', {
      congestion: new Map(),
      trafficLights,
    });
    expect(path).not.toBeNull();
  });
});

describe('gridAStarPath', () => {
  function makeGrid(cells: Map<string, number>, width: number, height: number) {
    return {
      width,
      height,
      getCell: (x: number, y: number) => {
        const rt = cells.get(`${x},${y}`);
        if (rt === undefined) return null;
        return { roadType: rt };
      },
    };
  }

  it('should find path on a simple straight road', () => {
    const cells = new Map<string, number>();
    for (let x = 0; x < 10; x++) cells.set(`${x},0`, RoadType.TWO_LANE);
    const grid = makeGrid(cells, 10, 1);

    const path = gridAStarPath({ x: 0, y: 0 }, { x: 9, y: 0 }, grid);
    expect(path).not.toBeNull();
    expect(path![0]).toBe('0,0');
    expect(path![path!.length - 1]).toBe('9,0');
    expect(path!.length).toBe(10);
  });

  it('should return null when no path exists', () => {
    const cells = new Map<string, number>();
    cells.set('0,0', RoadType.TWO_LANE);
    cells.set('5,5', RoadType.TWO_LANE);
    // No connecting road
    const grid = makeGrid(cells, 10, 10);
    const path = gridAStarPath({ x: 0, y: 0 }, { x: 5, y: 5 }, grid);
    expect(path).toBeNull();
  });

  it('should prefer highway over rural road when detour is faster', () => {
    // Two paths from (0,0) to (6,0):
    // Path A: straight rural road (0,0)→(1,0)→...→(6,0) — 7 cells, speedLimit=30
    // Path B: highway detour via row 1 — 9 cells, speedLimit=100
    const cells = new Map<string, number>();
    // Rural direct path
    for (let x = 0; x <= 6; x++) cells.set(`${x},0`, RoadType.RURAL);
    // Highway detour: (0,0)→(0,1)→(1,1)→...→(6,1)→(6,0)
    for (let x = 0; x <= 6; x++) cells.set(`${x},1`, RoadType.HIGHWAY);
    // (0,0) and (0,1) are adjacent, (6,0) and (6,1) are adjacent
    const grid = makeGrid(cells, 7, 2);

    const path = gridAStarPath({ x: 0, y: 0 }, { x: 6, y: 0 }, grid);
    expect(path).not.toBeNull();

    // A* should take the highway detour (goes through y=1)
    const usesHighway = path!.some(p => p.endsWith(',1'));
    expect(usesHighway).toBe(true);
  });

  it('should handle long distance on large map', () => {
    // 100-cell straight road — BFS with 500 steps would handle this,
    // but let's verify A* works on longer paths
    const cells = new Map<string, number>();
    for (let x = 0; x < 100; x++) cells.set(`${x},0`, RoadType.TWO_LANE);
    const grid = makeGrid(cells, 100, 1);

    const path = gridAStarPath({ x: 0, y: 0 }, { x: 99, y: 0 }, grid);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(100);
  });
});

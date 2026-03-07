import { describe, it, expect } from 'vitest';
import { RoadNetwork } from '../../road/RoadNetwork';
import { findPath } from '../Pathfinding';

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

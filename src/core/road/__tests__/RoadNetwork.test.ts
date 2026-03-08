import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../RoadBuilder';
import { RoadNetwork } from '../RoadNetwork';
import { RoadType } from '../types';

describe('RoadNetwork', () => {
  it('should add nodes and edges when building a road', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(network.getNodeCount()).toBe(5);
    expect(network.getEdgeCount()).toBe(4);
  });

  it('should report two points as connected when road exists', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(network.isConnected('2,5', '6,5')).toBe(true);
  });

  it('should report disconnected points when no road', () => {
    const network = new RoadNetwork();
    expect(network.isConnected('0,0', '5,5')).toBe(false);
  });

  it('should update graph when road is removed', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);

    expect(network.isConnected('0,5', '10,5')).toBe(true);

    builder.removeRoad(5, 5);
    expect(network.isConnected('0,5', '10,5')).toBe(false);
  });

  it('should connect branching roads', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 0 }, { x: 5, y: 10 }, RoadType.TWO_LANE, 100000);

    // All four endpoints should be connected through the intersection
    expect(network.isConnected('0,5', '5,10')).toBe(true);
    expect(network.isConnected('10,5', '5,0')).toBe(true);
  });

  it('should report self-connection', () => {
    const network = new RoadNetwork();
    network.addNode('1,1');
    expect(network.isConnected('1,1', '1,1')).toBe(true);
  });

  it('should return correct neighbors', () => {
    const network = new RoadNetwork();
    network.addEdge('5,5', '5,6');
    network.addEdge('5,5', '6,5');

    const neighbors = network.getNeighbors('5,5');
    expect(neighbors).toContain('5,6');
    expect(neighbors).toContain('6,5');
    expect(neighbors).toHaveLength(2);
  });

  it('should handle edge removal', () => {
    const network = new RoadNetwork();
    network.addEdge('a', 'b');
    network.addEdge('b', 'c');

    expect(network.isConnected('a', 'c')).toBe(true);

    network.removeEdge('a', 'b');
    expect(network.isConnected('a', 'c')).toBe(false);
    // b-c still connected
    expect(network.isConnected('b', 'c')).toBe(true);
  });

  it('should count edges correctly for complex network', () => {
    const network = new RoadNetwork();
    network.addEdge('a', 'b');
    network.addEdge('b', 'c');
    network.addEdge('c', 'd');

    expect(network.getEdgeCount()).toBe(3);
    expect(network.getNodeCount()).toBe(4);
  });

  it('should not duplicate edges', () => {
    const network = new RoadNetwork();
    network.addEdge('a', 'b');
    network.addEdge('a', 'b');

    expect(network.getEdgeCount()).toBe(1);
  });
});

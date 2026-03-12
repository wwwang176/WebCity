import { describe, it, expect } from 'vitest';
import { RailNetwork, rebuildRailNetworkFromGrid } from '../RailNetwork';
import { Grid } from '../../grid/Grid';
import { RailType, TrackDirection } from '../types';

describe('RailNetwork', () => {
  // --- Basic graph operations ---

  it('should add nodes and edges', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');

    expect(net.getNodeCount()).toBe(3);
    expect(net.getEdgeCount()).toBe(2);
  });

  it('should report connectivity', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');

    expect(net.isConnected('0,0', '2,0')).toBe(true);
    expect(net.isConnected('0,0', '5,5')).toBe(false);
  });

  it('should remove a node and disconnect neighbors', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');

    net.removeNode('1,0');

    expect(net.isConnected('0,0', '2,0')).toBe(false);
    expect(net.getNodeCount()).toBe(2);
  });

  it('should remove an edge', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');

    net.removeEdge('0,0', '1,0');

    expect(net.isConnected('0,0', '1,0')).toBe(false);
    expect(net.isConnected('1,0', '2,0')).toBe(true);
  });

  it('should return neighbors of a node', () => {
    const net = new RailNetwork();
    net.addEdge('5,5', '5,6');
    net.addEdge('5,5', '6,5');

    const neighbors = net.getNeighbors('5,5');
    expect(neighbors).toContain('5,6');
    expect(neighbors).toContain('6,5');
    expect(neighbors).toHaveLength(2);
  });

  it('should handle self-connectivity', () => {
    const net = new RailNetwork();
    net.addNode('3,3');
    expect(net.isConnected('3,3', '3,3')).toBe(true);
  });

  it('should handle hasNode', () => {
    const net = new RailNetwork();
    net.addNode('1,1');
    expect(net.hasNode('1,1')).toBe(true);
    expect(net.hasNode('2,2')).toBe(false);
  });

  // --- A* pathfinding ---

  it('should find a straight-line path', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');
    net.addEdge('2,0', '3,0');

    const path = net.findPath('0,0', '3,0');
    expect(path).toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('should find a path with turns', () => {
    const net = new RailNetwork();
    // L-shaped track: right then down
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');
    net.addEdge('2,0', '2,1');
    net.addEdge('2,1', '2,2');

    const path = net.findPath('0,0', '2,2');
    expect(path).toEqual(['0,0', '1,0', '2,0', '2,1', '2,2']);
  });

  it('should return null when no path exists', () => {
    const net = new RailNetwork();
    net.addEdge('0,0', '1,0');
    net.addNode('5,5');

    expect(net.findPath('0,0', '5,5')).toBeNull();
  });

  it('should return null when start node does not exist', () => {
    const net = new RailNetwork();
    net.addNode('0,0');
    expect(net.findPath('9,9', '0,0')).toBeNull();
  });

  it('should return single-node path when from equals to', () => {
    const net = new RailNetwork();
    net.addNode('3,3');
    expect(net.findPath('3,3', '3,3')).toEqual(['3,3']);
  });

  it('should find shortest path when alternatives exist', () => {
    const net = new RailNetwork();
    // Direct path: 0,0 → 1,0 → 2,0 (length 2)
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');
    // Detour: 0,0 → 0,1 → 1,1 → 2,1 → 2,0 (length 4)
    net.addEdge('0,0', '0,1');
    net.addEdge('0,1', '1,1');
    net.addEdge('1,1', '2,1');
    net.addEdge('2,1', '2,0');

    const path = net.findPath('0,0', '2,0');
    expect(path).toEqual(['0,0', '1,0', '2,0']);
  });
});

describe('rebuildRailNetworkFromGrid', () => {
  it('should populate rail network from grid rail cells', () => {
    const grid = new Grid(10, 10);
    // Two adjacent rail cells connected east-west
    grid.setCell(3, 5, { railType: RailType.STANDARD, railFlags: TrackDirection.EAST });
    grid.setCell(4, 5, { railType: RailType.STANDARD, railFlags: TrackDirection.WEST });

    const net = new RailNetwork();
    rebuildRailNetworkFromGrid(grid, net);

    // Node 3,5 should connect east to 4,5
    const path = net.findPath('3,5', '4,5');
    expect(path).not.toBeNull();
  });

  it('should skip non-rail cells', () => {
    const grid = new Grid(5, 5);
    const net = new RailNetwork();
    rebuildRailNetworkFromGrid(grid, net);
    // No nodes added
    expect(net.findPath('0,0', '1,0')).toBeNull();
  });
});

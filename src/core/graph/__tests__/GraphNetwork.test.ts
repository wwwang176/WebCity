import { describe, it, expect } from 'vitest';
import { GraphNetwork } from '../GraphNetwork';

describe('GraphNetwork', () => {
  // --- addNode / hasNode ---

  it('should add a node', () => {
    const g = new GraphNetwork();
    g.addNode('a');
    expect(g.hasNode('a')).toBe(true);
    expect(g.hasNode('b')).toBe(false);
  });

  it('should not duplicate nodes', () => {
    const g = new GraphNetwork();
    g.addNode('a');
    g.addNode('a');
    expect(g.getNodeCount()).toBe(1);
  });

  // --- addEdge ---

  it('should add an edge and implicitly create nodes', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    expect(g.hasNode('a')).toBe(true);
    expect(g.hasNode('b')).toBe(true);
    expect(g.getEdgeCount()).toBe(1);
  });

  it('should not duplicate edges', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.addEdge('a', 'b');
    expect(g.getEdgeCount()).toBe(1);
  });

  // --- removeNode ---

  it('should remove a node and clean up neighbor references', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');

    g.removeNode('b');

    expect(g.hasNode('b')).toBe(false);
    expect(g.getNeighbors('a')).toEqual([]);
    expect(g.getNeighbors('c')).toEqual([]);
  });

  it('should handle removing a non-existent node gracefully', () => {
    const g = new GraphNetwork();
    expect(() => g.removeNode('x')).not.toThrow();
  });

  // --- removeEdge ---

  it('should remove an edge without removing nodes', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.removeEdge('a', 'b');

    expect(g.hasNode('a')).toBe(true);
    expect(g.hasNode('b')).toBe(true);
    expect(g.getEdgeCount()).toBe(0);
  });

  // --- isConnected (BFS) ---

  it('should report connected nodes', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');
    expect(g.isConnected('a', 'c')).toBe(true);
  });

  it('should report disconnected nodes', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.addNode('c');
    expect(g.isConnected('a', 'c')).toBe(false);
  });

  it('should report self-connection', () => {
    const g = new GraphNetwork();
    g.addNode('x');
    expect(g.isConnected('x', 'x')).toBe(true);
  });

  it('should return false for non-existent nodes', () => {
    const g = new GraphNetwork();
    expect(g.isConnected('x', 'y')).toBe(false);
  });

  // --- getNodeCount / getEdgeCount ---

  it('should count nodes and edges correctly', () => {
    const g = new GraphNetwork();
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');
    g.addEdge('c', 'd');

    expect(g.getNodeCount()).toBe(4);
    expect(g.getEdgeCount()).toBe(3);
  });

  // --- getNeighbors ---

  it('should return neighbors of a node', () => {
    const g = new GraphNetwork();
    g.addEdge('x', 'y');
    g.addEdge('x', 'z');

    const neighbors = g.getNeighbors('x');
    expect(neighbors).toContain('y');
    expect(neighbors).toContain('z');
    expect(neighbors).toHaveLength(2);
  });

  it('should return empty array for non-existent node', () => {
    const g = new GraphNetwork();
    expect(g.getNeighbors('nope')).toEqual([]);
  });
});

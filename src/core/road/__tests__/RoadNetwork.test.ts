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

    expect(network.getNodeCount()).toBeGreaterThanOrEqual(2);
    expect(network.getEdgeCount()).toBeGreaterThanOrEqual(1);
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
});

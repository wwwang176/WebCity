import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../RoadBuilder';
import { RoadNetwork } from '../RoadNetwork';
import { Intersection } from '../Intersection';
import { RoadType, IntersectionType, TrafficControl } from '../types';

describe('Intersection', () => {
  it('should detect a CROSS intersection (4 directions)', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    const type = intersection.getType(5, 5);
    expect(type).toBe(IntersectionType.CROSS);
  });

  it('should detect a T_JUNCTION (3 directions)', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 5 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    const type = intersection.getType(5, 5);
    expect(type).toBe(IntersectionType.T_JUNCTION);
  });

  it('should default to TRAFFIC_LIGHT control', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    expect(intersection.getControl(5, 5)).toBe(TrafficControl.TRAFFIC_LIGHT);
  });

  it('should switch to ROUNDABOUT control', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    intersection.setControl(5, 5, TrafficControl.ROUNDABOUT);
    expect(intersection.getControl(5, 5)).toBe(TrafficControl.ROUNDABOUT);
  });
});

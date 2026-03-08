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

  it('should return NONE for straight road (2 directions)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    expect(intersection.getType(5, 5)).toBe(IntersectionType.NONE);
  });

  it('should return NONE for dead-end (1 direction)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    // Endpoint cell has only WEST flag
    expect(intersection.getType(5, 5)).toBe(IntersectionType.NONE);
  });

  it('should return NONE control for non-intersection', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    expect(intersection.getControl(5, 5)).toBe(TrafficControl.NONE);
  });

  it('should detect intersection with mixed road types', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.FOUR_LANE, 100000);

    const intersection = new Intersection(grid);
    // Still a CROSS intersection regardless of road types
    expect(intersection.getType(5, 5)).toBe(IntersectionType.CROSS);
  });

  it('should return NONE for empty cell', () => {
    const grid = new Grid(20, 20);
    const intersection = new Intersection(grid);
    expect(intersection.getType(5, 5)).toBe(IntersectionType.NONE);
  });

  it('should preserve custom control after additional roads built', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const intersection = new Intersection(grid);
    intersection.setControl(5, 5, TrafficControl.ROUNDABOUT);

    // Control is stored separately, not in grid
    expect(intersection.getControl(5, 5)).toBe(TrafficControl.ROUNDABOUT);
  });
});

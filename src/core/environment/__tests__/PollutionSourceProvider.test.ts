import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { getGridPollutionSources, GRID_POLLUTION } from '../GridPollutionSources';

describe('getGridPollutionSources', () => {
  it('returns ground + noise for industrial buildings', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 10 });
    const sources = getGridPollutionSources(grid);

    const ground = sources.filter(s => s.x === 2 && s.y === 2 && s.type === 'ground');
    const noise = sources.filter(s => s.x === 2 && s.y === 2 && s.type === 'noise');
    expect(ground.length).toBe(1);
    expect(ground[0]!.amount).toBe(GRID_POLLUTION.INDUSTRIAL_GROUND);
    expect(noise.length).toBe(1);
    expect(noise[0]!.amount).toBe(GRID_POLLUTION.INDUSTRIAL_NOISE);
  });

  it('industrial ground pollution should have radius', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 10 });
    const sources = getGridPollutionSources(grid);
    const ground = sources.find(s => s.x === 2 && s.y === 2 && s.type === 'ground');
    const noise = sources.find(s => s.x === 2 && s.y === 2 && s.type === 'noise');
    expect(ground!.radius).toBe(GRID_POLLUTION.INDUSTRIAL_GROUND_RADIUS);
    expect(noise!.radius).toBe(GRID_POLLUTION.INDUSTRIAL_NOISE_RADIUS);
  });

  it('returns noise for roads with traffic using speed factor', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE, trafficDensity: 5 });
    const sources = getGridPollutionSources(grid);

    const noise = sources.filter(s => s.x === 1 && s.y === 1 && s.type === 'noise');
    expect(noise.length).toBe(1);
    expect(noise[0]!.amount).toBe(5 * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER * GRID_POLLUTION.ROAD_SPEED_FACTOR[RoadType.TWO_LANE]);
  });

  it('highway should produce more noise than two-lane at same density', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE, trafficDensity: 5 });
    grid.setCell(2, 2, { roadType: RoadType.HIGHWAY, trafficDensity: 5 });
    const sources = getGridPollutionSources(grid);
    const twoLane = sources.find(s => s.x === 1 && s.y === 1)!;
    const highway = sources.find(s => s.x === 2 && s.y === 2)!;
    expect(highway.amount).toBeGreaterThan(twoLane.amount);
  });

  it('road traffic noise should have radius', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE, trafficDensity: 5 });
    const sources = getGridPollutionSources(grid);
    const noise = sources.find(s => s.x === 1 && s.y === 1 && s.type === 'noise');
    expect(noise!.radius).toBe(GRID_POLLUTION.TRAFFIC_NOISE_RADIUS);
  });

  it('skips roads with zero traffic density', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE, trafficDensity: 0 });
    const sources = getGridPollutionSources(grid);
    expect(sources.length).toBe(0);
  });

  it('returns empty for empty grid', () => {
    const grid = new Grid(3, 3);
    expect(getGridPollutionSources(grid)).toEqual([]);
  });
});

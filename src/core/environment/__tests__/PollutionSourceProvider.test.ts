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

  it('returns noise for roads with traffic', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE, trafficDensity: 5 });
    const sources = getGridPollutionSources(grid);

    const noise = sources.filter(s => s.x === 1 && s.y === 1 && s.type === 'noise');
    expect(noise.length).toBe(1);
    expect(noise[0]!.amount).toBe(5 * GRID_POLLUTION.TRAFFIC_NOISE_MULTIPLIER);
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

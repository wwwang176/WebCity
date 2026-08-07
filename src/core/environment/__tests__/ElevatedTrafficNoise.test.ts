import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { forEachGridPollutionSource } from '../GridPollutionSources';
import type { PollutionSource } from '../Pollution';

/**
 * syncTrafficDensityToGrid projects elevated traffic flow down onto the ground
 * cell's trafficDensity — its module doc says explicitly that this exists "for
 * noise pollution calculation", and forEachGridPollutionSource is its only
 * consumer. But the guard tested the GROUND roadType, so wherever a viaduct
 * crossed undeveloped land the tier was NONE and the projected noise was
 * discarded entirely (BUG-099).
 */
function collect(grid: Grid, elevatedRoadType?: (x: number, y: number) => number): PollutionSource[] {
  const out: PollutionSource[] = [];
  forEachGridPollutionSource(grid, s => out.push(s), elevatedRoadType);
  return out;
}

describe('elevated traffic noise reaches the pollution grid', () => {
  it('should emit noise for a viaduct over undeveloped land', () => {
    const grid = new Grid(10, 10);
    // Ground is empty; the flow was projected down from the elevated segment.
    grid.setCell(4, 4, { trafficDensity: 8 });

    const sources = collect(grid, (x, y) => (x === 4 && y === 4 ? RoadType.HIGHWAY : 0));

    expect(sources.some(s => s.x === 4 && s.y === 4 && s.type === 'noise' && s.amount > 0)).toBe(true);
  });

  it('should emit nothing where there is neither a ground nor an elevated road', () => {
    const grid = new Grid(10, 10);
    grid.setCell(4, 4, { trafficDensity: 8 });

    expect(collect(grid)).toHaveLength(0);
  });

  it('should still emit noise for an ordinary ground road', () => {
    const grid = new Grid(10, 10);
    grid.setCell(4, 4, { roadType: RoadType.TWO_LANE, trafficDensity: 8 });

    expect(collect(grid).some(s => s.type === 'noise' && s.amount > 0)).toBe(true);
  });

  it('should prefer the ground tier when both exist', () => {
    const grid = new Grid(10, 10);
    grid.setCell(4, 4, { roadType: RoadType.RURAL, trafficDensity: 8 });

    const withElevated = collect(grid, () => RoadType.HIGHWAY);
    const groundOnly = collect(grid);

    expect(withElevated[0]!.amount).toBe(groundOnly[0]!.amount);
  });
});

import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { PoliceService } from '../PoliceService';
import { FireService } from '../FireService';
import { GarbageService } from '../GarbageService';
import { RoadType } from '../../road/types';
import { RoadDirection } from '../../road/types';

/**
 * Integration tests verifying that road topology changes
 * correctly trigger coverage recalculation.
 */

function setupGridWithRoad(width: number, height: number, roadY: number, roadStartX = 1, roadEndX?: number): Grid {
  const grid = new Grid(width, height);
  const endX = roadEndX ?? width - 1;
  for (let x = roadStartX; x <= endX; x++) {
    grid.setCell(x, roadY, { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
  }
  return grid;
}

describe('Road coverage recalculation on road changes', () => {
  it('police coverage updates when road is added', () => {
    const grid = new Grid(20, 20);
    const police = new PoliceService();
    // Place station at (0, 10), no road yet
    police.addStation(0, 10);
    police.recalculateCoverage(grid);
    expect(police.getCoverage(5, 10)).toBe(false); // no road = no coverage

    // Add road from x=1 to x=15 at y=10
    for (let x = 1; x <= 15; x++) {
      grid.setCell(x, 10, { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
    }
    police.recalculateCoverage(grid);
    expect(police.getCoverage(5, 10)).toBe(true); // now covered via road
  });

  it('fire coverage shrinks when road is demolished', () => {
    const grid = setupGridWithRoad(20, 20, 10);
    const fire = new FireService();
    fire.addStation(0, 10);
    fire.recalculateCoverage(grid);

    expect(fire.getCoverage(5, 10)).toBe(true);
    expect(fire.getCoverage(10, 10)).toBe(true);

    // Remove road at x=3 (creates gap)
    grid.setCell(3, 10, { roadType: 0, roadFlags: 0 });
    fire.recalculateCoverage(grid);

    // Cells before gap still covered (x=1,2 reachable)
    expect(fire.getCoverage(2, 10)).toBe(true);
    // Cells after gap no longer reachable
    expect(fire.getCoverage(5, 10)).toBe(false);
    expect(fire.getCoverage(10, 10)).toBe(false);
  });

  it('garbage coverage extends when road connects to new area', () => {
    const grid = new Grid(30, 30);
    const garbage = new GarbageService();
    garbage.addFacility(0, 15);

    // Road segment 1: x=1..10 at y=15
    for (let x = 1; x <= 10; x++) {
      grid.setCell(x, 15, { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
    }
    garbage.recalculateCoverage(grid);
    expect(garbage.getCoverage(5, 15)).toBe(true);
    expect(garbage.getCoverage(15, 15)).toBe(false); // disconnected

    // Connect road segment: x=11..20 at y=15
    for (let x = 11; x <= 20; x++) {
      grid.setCell(x, 15, { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
    }
    garbage.recalculateCoverage(grid);
    // Now connected within budget range
    expect(garbage.getCoverage(15, 15)).toBe(true);
  });

  it('coverage includes buildings adjacent to roads', () => {
    const grid = setupGridWithRoad(20, 20, 10);
    const police = new PoliceService();
    police.addStation(0, 10);
    police.recalculateCoverage(grid);

    // Buildings above and below road should be covered
    expect(police.getCoverage(5, 9)).toBe(true);  // above road
    expect(police.getCoverage(5, 11)).toBe(true); // below road
  });

  it('forEachCovered iterates covered cells with cost ratio', () => {
    const grid = setupGridWithRoad(20, 20, 10);
    const police = new PoliceService();
    police.addStation(0, 10);
    police.recalculateCoverage(grid);

    const coveredCells = police.getCoveredCellsWithCost();
    expect(coveredCells.size).toBeGreaterThan(0);
  });
});

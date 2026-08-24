import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { ElevationManager } from '../../elevation/ElevationManager';
import { placeInfraOnGrid, MULTI_CELL_OCCUPIED } from '../InfraPlacement';
import { getInfraBuildingId } from '../InfraConfig';
import { tallyDemolish, EMPTY_DEMOLISH_TALLY } from '../DemolishTally';

function emptyGrid(): Grid {
  return new Grid(20, 20);
}

/** The plainest possible elevated segment. */
function segment(roadType = RoadType.TWO_LANE) {
  return { roadType, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 };
}

describe('拆除前先數一次:到底會拆掉什麼', () => {
  it('should count nothing on empty land', () => {
    // Clearing 42 cells and clearing 0 cells have to answer differently.
    const t = tallyDemolish(emptyGrid(), new ElevationManager(), 0, 0, 6, 6);

    expect(t).toEqual(EMPTY_DEMOLISH_TALLY);
    expect(t.cells).toBe(0);
  });

  it('should count a road cell', () => {
    const grid = emptyGrid();
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);

    expect(t.roads).toBe(1);
    expect(t.cells).toBe(1);
    expect(t.buildings).toBe(0);
  });

  it('should count zoning that has nothing built on it yet', () => {
    // Zoned land with nothing built yet: demolition clears the zone, so this is not
    // "nothing happened".
    const grid = emptyGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);

    expect(t.zones).toBe(1);
    expect(t.buildings).toBe(0);
    expect(t.cells).toBe(1);
  });

  it('should count a built zone cell once in cells but in both categories', () => {
    // The categories answer different questions (buildings gone vs zoned cells cleared), so
    // one cell falls into both. `cells` is the de-duplicated count.
    const grid = emptyGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 10 });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);

    expect(t.buildings).toBe(1);
    expect(t.zones).toBe(1);
    expect(t.cells, '同一格被算了兩次').toBe(1);
  });

  it('should count a rail cell', () => {
    const grid = emptyGrid();
    grid.setCell(4, 4, { railType: 1 });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);

    expect(t.rails).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count a 2x2 facility as one building over four cells', () => {
    const grid = emptyGrid();
    placeInfraOnGrid(grid, 3, 3, 'police', 0);

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 9, 9);

    expect(t.infrastructure, '一座警局被數成四座').toBe(1);
    expect(t.cells, '佔了四格就該有四格被清掉').toBe(4);
  });

  it('should count a facility that is only clipped by the rect', () => {
    // The selection catches one corner of the police station. That still demolishes the whole
    // building, so the count is not zero.
    const grid = emptyGrid();
    placeInfraOnGrid(grid, 3, 3, 'police', 0);

    const t = tallyDemolish(grid, new ElevationManager(), 4, 4, 4, 4);

    expect(t.infrastructure).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count a 1x1 facility', () => {
    const grid = emptyGrid();
    placeInfraOnGrid(grid, 5, 5, 'bus_stop', 0);

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 9, 9);

    expect(t.infrastructure).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count an orphaned infrastructure cell', () => {
    // A facility cell whose primary cell cannot be found, left behind by a corrupt save or a
    // half-demolished multi-cell building (BUG-052). Demolition still clears it and tries to
    // unregister, so the count is not zero.
    const grid = emptyGrid();
    grid.setCell(5, 5, { buildingId: getInfraBuildingId('police'), reserved: MULTI_CELL_OCCUPIED });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 9, 9);

    expect(t.infrastructure).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count an elevated segment standing over empty ground', () => {
    // A bridge crossing empty land. Nothing sits on the ground, so reading the Grid alone
    // answers "nothing was demolished".
    const elevation = new ElevationManager();
    elevation.set(7, 7, 1, segment());

    const t = tallyDemolish(emptyGrid(), elevation, 0, 0, 9, 9);

    expect(t.elevated).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count a cell with both a bridge and a road under it once', () => {
    const grid = emptyGrid();
    grid.setCell(7, 7, { roadType: RoadType.TWO_LANE });
    const elevation = new ElevationManager();
    elevation.set(7, 7, 1, segment());

    const t = tallyDemolish(grid, elevation, 0, 0, 9, 9);

    expect(t.roads).toBe(1);
    expect(t.elevated).toBe(1);
    expect(t.cells, '橋和它底下的路被算成兩格').toBe(1);
  });

  it('should count one cell per stacked level', () => {
    // Two levels stacked on one cell. Demolition clears both, so `elevated` has to show two
    // segments.
    const elevation = new ElevationManager();
    elevation.set(7, 7, 1, segment());
    elevation.set(7, 7, 2, segment());

    const t = tallyDemolish(emptyGrid(), elevation, 0, 0, 9, 9);

    expect(t.elevated, '疊起來的兩層只被數成一段').toBe(2);
    expect(t.cells).toBe(1);
  });

  it('should take the rect in either direction', () => {
    const grid = emptyGrid();
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });

    const forward = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);
    const backward = tallyDemolish(grid, new ElevationManager(), 6, 6, 0, 0);

    expect(backward).toEqual(forward);
  });

  it('should ignore cells outside the grid', () => {
    const grid = emptyGrid();
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE });

    const t = tallyDemolish(grid, new ElevationManager(), -5, -5, 2, 2);

    expect(t.roads).toBe(1);
    expect(t.cells).toBe(1);
  });
});

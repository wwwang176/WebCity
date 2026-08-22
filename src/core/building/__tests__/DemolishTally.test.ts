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

/** 一段最陽春的高架路段。 */
function segment(roadType = RoadType.TWO_LANE) {
  return { roadType, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 };
}

describe('拆除前先數一次:到底會拆掉什麼', () => {
  it('should count nothing on empty land', () => {
    // 這一條就是整件事的理由。拆 42 格和拆 0 格必須答得不一樣。
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
    // 劃了分區但還沒長出建築 —— 拆除會把分區清掉，所以它不是「什麼也沒做」。
    const grid = emptyGrid();
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 6, 6);

    expect(t.zones).toBe(1);
    expect(t.buildings).toBe(0);
    expect(t.cells).toBe(1);
  });

  it('should count a built zone cell once in cells but in both categories', () => {
    // 分類回答的是不同的問題（幾棟房子沒了／幾格分區被清掉），所以同一格會同時
    // 落在兩類。`cells` 是不重複的那一個。
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
    // 只框到警局的一角。那一下仍然會拆掉整座 —— 所以它不是零。
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
    // 找不到主格的設施格 —— 存檔壞掉或多格建築被拆到一半留下的（BUG-052）。
    // 拆除仍然會清掉它並試著解除註冊，所以它不是零。
    const grid = emptyGrid();
    grid.setCell(5, 5, { buildingId: getInfraBuildingId('police'), reserved: MULTI_CELL_OCCUPIED });

    const t = tallyDemolish(grid, new ElevationManager(), 0, 0, 9, 9);

    expect(t.infrastructure).toBe(1);
    expect(t.cells).toBe(1);
  });

  it('should count an elevated segment standing over empty ground', () => {
    // 一座橫過空地的橋。地面什麼都沒有,只看 Grid 會回答「什麼也沒拆」。
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
    // 同一格疊了兩層。拆除把兩層都清掉,所以 `elevated` 要看得出來有兩段。
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

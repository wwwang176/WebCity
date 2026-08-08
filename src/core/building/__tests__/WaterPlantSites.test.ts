import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { findWaterPlantSites, hasAnyWaterPlantSite } from '../WaterPlantSites';
import { GROUNDWATER_SEARCH_RANGE } from '../../grid/Terrain';
import { getInfraBuildingId } from '../InfraConfig';

/**
 * Nothing in the city grows without water, and a water plant needs groundwater
 * — which means being within GROUNDWATER_SEARCH_RANGE of water. A player who
 * starts inland watches the population sit at zero and the funds drain into
 * road maintenance, and the only feedback is a toast on the click that failed.
 *
 * This is the query behind the fix: the cells where a plant CAN go.
 */
function riverMap(): Grid {
  const grid = new Grid(30, 30);
  for (let y = 0; y < 30; y++) grid.setCell(2, y, { terrainType: TerrainType.WATER });
  // A road, because canPlaceInfra also wants road access.
  for (let y = 0; y < 30; y++) grid.setCell(6, y, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
  return grid;
}

describe('the game can say where a water plant would work', () => {
  it('should find sites beside a river', () => {
    const sites = findWaterPlantSites(riverMap());
    expect(sites.length).toBeGreaterThan(0);
  });

  it('should only return cells within groundwater range of water', () => {
    // The river is at x = 2, so every site must be close enough to it.
    for (const s of findWaterPlantSites(riverMap())) {
      expect(Math.abs(s.x - 2), `(${s.x},${s.y}) is too far from the river`)
        .toBeLessThanOrEqual(GROUNDWATER_SEARCH_RANGE);
    }
  });

  it('should find nothing on a map with no water at all', () => {
    const dry = new Grid(30, 30);
    for (let y = 0; y < 30; y++) dry.setCell(6, y, { roadType: RoadType.TWO_LANE, roadFlags: 3 });
    expect(findWaterPlantSites(dry)).toEqual([]);
    expect(hasAnyWaterPlantSite(dry)).toBe(false);
  });

  it('should say a river map is workable', () => {
    expect(hasAnyWaterPlantSite(riverMap())).toBe(true);
  });

  it('should not offer a cell another utility already occupies', () => {
    // A ZONE building would not disqualify it — isCellBuildable blocks only
    // infrastructure, because placing a utility over a house demolishes the
    // house. Another utility is the case that really is unavailable.
    const grid = riverMap();
    const first = findWaterPlantSites(grid)[0]!;
    grid.setCell(first.x, first.y, { buildingId: getInfraBuildingId('power') });
    expect(findWaterPlantSites(grid).some(s => s.x === first.x && s.y === first.y)).toBe(false);
  });

  it('should still offer a cell with a house on it', () => {
    // The other side of the same rule, so neither is assumed.
    const grid = riverMap();
    const first = findWaterPlantSites(grid)[0]!;
    grid.setCell(first.x, first.y, { buildingId: 1 });
    expect(findWaterPlantSites(grid).some(s => s.x === first.x && s.y === first.y)).toBe(true);
  });

  it('should not offer a cell with no road access', () => {
    // Water beside nothing at all is not a site: canPlaceInfra requires a road,
    // and a plant nobody can reach supplies nobody.
    const grid = new Grid(30, 30);
    for (let y = 0; y < 30; y++) grid.setCell(2, y, { terrainType: TerrainType.WATER });
    expect(findWaterPlantSites(grid)).toEqual([]);
  });

  it('should stop at the limit it was given', () => {
    // A long river has thousands of valid cells and the caller only draws a
    // hint; scanning them all every frame is not free.
    expect(findWaterPlantSites(riverMap(), 3)).toHaveLength(3);
  });

  it('should answer the yes/no question without scanning the map', () => {
    // hasAnyWaterPlantSite is the cheap form, used on a path that runs often.
    const grid = riverMap();
    expect(hasAnyWaterPlantSite(grid)).toBe(findWaterPlantSites(grid, 1).length > 0);
  });
});

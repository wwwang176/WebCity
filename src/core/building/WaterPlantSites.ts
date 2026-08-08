import { Grid } from '../grid/Grid';
import { getGroundwaterLevel } from '../grid/Terrain';
import { canPlaceInfra } from './InfraPlacement';

/**
 * Where a water plant can actually go.
 *
 * A water plant needs groundwater, which means being within
 * GROUNDWATER_SEARCH_RANGE of water — and nothing grows at all without water,
 * so an inland start is unwinnable. The only feedback was a toast on the click
 * that failed ("No groundwater here — build near rivers"), which tells the
 * player what is wrong but not where to go instead. Meanwhile the water overlay
 * highlights BUILDINGS, of which a stalled city has none, so it showed nothing.
 *
 * Kept in core so the answer is testable without a renderer; Game highlights
 * whatever this returns.
 */
export interface WaterPlantSite { x: number; y: number }

/**
 * @param limit Stop after this many. A large map has thousands of valid cells
 *   along a river and the caller only draws a hint, not a survey.
 */
export function findWaterPlantSites(grid: Grid, limit = 400): WaterPlantSite[] {
  const sites: WaterPlantSite[] = [];
  const groundwaterFn = (gx: number, gy: number) => getGroundwaterLevel(grid, gx, gy);

  for (let y = 0; y < grid.height && sites.length < limit; y++) {
    for (let x = 0; x < grid.width && sites.length < limit; x++) {
      if (canPlaceInfra(grid, x, y, 'water', 0, groundwaterFn).ok) sites.push({ x, y });
    }
  }
  return sites;
}

/**
 * Is this map winnable from where the player is standing?
 *
 * Distinct from "no site nearby": a map with NO site at all needs a different
 * sentence, because there is nowhere to walk to.
 */
export function hasAnyWaterPlantSite(grid: Grid): boolean {
  return findWaterPlantSites(grid, 1).length > 0;
}

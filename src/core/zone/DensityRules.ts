import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { ZONE_ROAD_REACH } from '../grid/constants';

export type DensityLevel = 'NONE' | 'LOW' | 'HIGH';

/**
 * Returns the best density tier reachable from (x, y) by scanning any road
 * within Chebyshev distance `ZONE_ROAD_REACH`. Matches the reach used by
 * ZoneManager/BuildingGrowth so extended zone cells can inherit the nearest
 * road's density.
 */
export function getMaxDensity(grid: Grid, x: number, y: number): DensityLevel {
  let bestDensity: DensityLevel = 'NONE';

  for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
    for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cell = grid.getCell(x + dx, y + dy);
      if (cell && cell.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[cell.roadType as RoadType];
        if (config) {
          if (config.maxDensity === 'HIGH') return 'HIGH';
          if (config.maxDensity === 'LOW' && bestDensity === 'NONE') bestDensity = 'LOW';
        }
      }
    }
  }

  return bestDensity;
}

/**
 * Which building tier a zone should draw from, given the best road it can reach.
 * `null` means nothing can be built here.
 *
 * getMaxDensity answers "how much does the road permit"; on its own that is the
 * wrong question, and asking only it cost the game four dead zone/road pairs.
 * tryGrow used to feed the road's tier straight into getBuildingsForZone, so a
 * RESIDENTIAL_LOW plot beside a four-lane road looked up (RESIDENTIAL_LOW,
 * 'HIGH') — a pair BUILDING_TYPES does not contain — and got an empty list on
 * every tick forever. The mirror case killed RESIDENTIAL_HIGH and
 * COMMERCIAL_HIGH on two-lane streets. canGrow returned true in all four, so
 * nothing anywhere reported a problem.
 *
 * The rule the game wants: a zone already knows its own density. The road only
 * has to be big enough to carry it. A six-lane road happily fronts small
 * houses. OFFICE is the sole zone with both tiers in BUILDING_TYPES, so it is
 * the sole zone whose tier the road gets to pick.
 */
export function getGrowthDensity(
  zoneType: ZoneType, roadDensity: DensityLevel,
): 'LOW' | 'HIGH' | null {
  if (roadDensity === 'NONE') return null;

  switch (zoneType) {
    case ZoneType.RESIDENTIAL_LOW:
    case ZoneType.COMMERCIAL_LOW:
    case ZoneType.INDUSTRIAL:
      return 'LOW';

    case ZoneType.RESIDENTIAL_HIGH:
    case ZoneType.COMMERCIAL_HIGH:
      // A two-lane street cannot carry an apartment block. Refusing is right;
      // the player is told to widen the road rather than left guessing.
      return roadDensity === 'HIGH' ? 'HIGH' : null;

    case ZoneType.OFFICE:
      return roadDensity;

    default:
      return null;
  }
}

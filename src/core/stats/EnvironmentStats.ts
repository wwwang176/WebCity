import type { GameState } from '../simulation/GameState';
import { BURNED, ABANDONED } from '../building/InfraPlacement';

/**
 * Environment — the Environment page of Overview.
 *
 * ## Two averages, two sets of cells
 *
 * - **Ground pollution** averages over cells that have a building **or** a zone, matching
 *   the panel.
 * - **Noise** averages over cells that have a building only. `noiseLevel` is written solely
 *   by `updateLandValue`, which returns early when `buildingId === 0`, so empty zoned land
 *   always reads 0 and including it dilutes the average by the share of land not yet built
 *   on (BUG-092).
 */

export interface EnvironmentStats {
  /** Average ground pollution over cells with a building or a zone. */
  avgGroundPollution: number;
  /** Average noise over cells with a building. */
  avgNoise: number;
  /** Water pollution at the outlets. */
  waterPollution: number;

  /** Fires currently burning. */
  activeFires: number;
  /** Extinguished today. */
  extinguishedToday: number;
  /** Extinguished over the last 30 days. */
  extinguishedRecent: number;

  /** Buildings burned to a shell. */
  burnedBuildings: number;
  /** Buildings abandoned by their occupants. */
  abandonedBuildings: number;
}

export function buildEnvironmentStats(state: GameState): EnvironmentStats {
  let pollutionTotal = 0;
  let pollutionCells = 0;
  let noiseTotal = 0;
  let noiseCells = 0;
  let burnedBuildings = 0;
  let abandonedBuildings = 0;

  state.grid.forEachCell((cell) => {
    if (cell.buildingId > 0 || cell.zoneType > 0) {
      pollutionTotal += cell.pollution;
      pollutionCells++;
    }
    // A 0 on empty zoned land means "nothing has written this cell", not "it is quiet here".
    if (cell.buildingId > 0) {
      noiseTotal += cell.noiseLevel;
      noiseCells++;
    }
    if (cell.reserved === BURNED) burnedBuildings++;
    if (cell.reserved === ABANDONED) abandonedBuildings++;
  });

  return {
    avgGroundPollution: pollutionCells > 0 ? pollutionTotal / pollutionCells : 0,
    avgNoise: noiseCells > 0 ? noiseTotal / noiseCells : 0,
    waterPollution: state.sewage.getWaterPollution(),

    activeFires: state.fire.getActiveFires().length,
    extinguishedToday: state.fire.getTodayExtinguished(),
    extinguishedRecent: state.fire.getRecentExtinguished(),

    burnedBuildings,
    abandonedBuildings,
  };
}

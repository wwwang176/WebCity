import type { GameState } from '../simulation/GameState';
import { BURNED, ABANDONED } from '../building/InfraPlacement';

/**
 * 環境 —— Overview 的 Environment 頁。
 *
 * ## 兩種平均，兩組格子
 *
 * - **地面污染**算在「有建築**或**有劃分區」的格子上,跟面板一樣。
 * - **噪音**只算**有建築**的格子。`noiseLevel` 只有 `updateLandValue` 會寫，而它在
 *   `buildingId === 0` 就提早回去了 —— 空的分區地永遠讀到 0,把它們算進平均會依
 *   「還沒蓋起來的比例」稀釋掉整個數字（BUG-092 就是這樣被發現的）。
 *
 * 面板的 Noise 欄位長期印著「-」:那份 memo 裡的 `totalNoise` 宣告了卻沒有人加值。
 * 資料一直都在格子裡,只是沒有人去讀。
 */

export interface EnvironmentStats {
  /** 有建築或有分區的格子上的平均地面污染。 */
  avgGroundPollution: number;
  /** 有建築的格子上的平均噪音。 */
  avgNoise: number;
  /** 排放口的水污染。 */
  waterPollution: number;

  /** 正在燒的火。 */
  activeFires: number;
  /** 今天撲滅的。 */
  extinguishedToday: number;
  /** 最近 30 天撲滅的。 */
  extinguishedRecent: number;

  /** 燒成焦黑的建築。 */
  burnedBuildings: number;
  /** 被居民遺棄的建築。 */
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
    // 空的分區地讀到的 0 不是「這裡很安靜」，是「沒有人寫過這一格」。
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

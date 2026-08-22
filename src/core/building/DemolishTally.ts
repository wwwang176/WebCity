import type { Grid } from '../grid/Grid';
import { normalizeRect } from '../grid/GridHelpers';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import type { ElevationManager } from '../elevation/ElevationManager';
import { MIN_ELEVATION_LEVEL, MAX_ELEVATION_LEVEL } from '../elevation/types';
import { classifyDemolishCell } from './DemolishClassifier';
import { isInfrastructureBuilding } from './InfraConfig';
import { findPrimaryCell } from './InfraPlacement';

/**
 * 這一下拆除會清掉什麼。
 *
 * ## 為什麼要有這一份
 *
 * 拆除的回傳值原本是**三個常數**:`cost` 恆 0（拆除不動錢包）、`ok` 恆 true
 * （拆除不產生 notification）、沒有 `reason` 也沒有 `info`。於是拆 42 格和拆 0 格
 * 收到的回應一字不差，程式無法判斷自己是不是白做工（BUG-366）。
 *
 * ## 為什麼是拆之前掃一遍，而不是在拆的迴圈裡累加
 *
 * 計數與破壞分開，計數就完全是純函式 —— `Game.demolish()` 直接 import Three.js，
 * 寫在那條迴圈裡的規則單元測試載不動，改壞了整套測試照樣全綠。
 *
 * 代價是同一塊矩形走兩遍。分類**共用 `classifyDemolishCell`**，所以兩遍看到的是
 * 同一套規則 —— 抄一份判斷過來才是這個 repo 一再出事的那個錯。
 */
export interface DemolishTally {
  /** 有東西被清掉的格子數。**不重複計算** —— 橋和它底下的路是一格。 */
  cells: number;
  /** 分區建築（住商工辦）。 */
  buildings: number;
  /** 地面道路格。 */
  roads: number;
  /** 地面鐵軌格。 */
  rails: number;
  /** 公共設施。多格建築算**一座**，不是一格一座。 */
  infrastructure: number;
  /**
   * 被清掉的分區格。
   *
   * 與 `buildings` 是**兩個問題**（幾棟房子沒了／幾格分區被清掉），所以一格上有
   * 建築的住宅地會同時落在兩類。不重複的總數看 `cells`。
   */
  zones: number;
  /** 高架**段**數。同一格疊了兩層就是 2。 */
  elevated: number;
}

export const EMPTY_DEMOLISH_TALLY: DemolishTally = {
  cells: 0, buildings: 0, roads: 0, rails: 0, infrastructure: 0, zones: 0, elevated: 0,
};

/**
 * 掃一遍矩形，數出這一下拆除會清掉什麼。**不改任何東西。**
 *
 * 界外的格子不算（`grid.getCell` 回 null），矩形反過來給也可以。
 */
export function tallyDemolish(
  grid: Grid,
  elevation: ElevationManager,
  x1: number, y1: number, x2: number, y2: number,
): DemolishTally {
  const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
  const t: DemolishTally = { ...EMPTY_DEMOLISH_TALLY };
  // 多格設施會被它佔到的每一格各碰到一次，只認第一次。
  const infraSeen = new Set<string>();

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = grid.getCell(x, y);
      if (!cell) continue;

      let touched = false;

      for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
        if (elevation.get(x, y, lv)) { t.elevated++; touched = true; }
      }

      const primary = isInfrastructureBuilding(cell.buildingId)
        ? findPrimaryCell(grid, x, y) : null;
      const action = classifyDemolishCell(cell, primary);

      switch (action.action) {
        case 'skip': break;
        case 'multi_cell_infra': {
          const key = `${action.primaryX},${action.primaryY}`;
          if (!infraSeen.has(key)) { infraSeen.add(key); t.infrastructure++; }
          touched = true;
          break;
        }
        case 'single_cell_infra':
          t.infrastructure++;
          touched = true;
          break;
        case 'regular':
          if (cell.buildingId !== 0) { t.buildings++; touched = true; }
          if (cell.roadType !== RoadType.NONE) { t.roads++; touched = true; }
          if (action.hasTrack) { t.rails++; touched = true; }
          if (cell.zoneType !== ZoneType.NONE) { t.zones++; touched = true; }
          // `reserved`（廢棄、焦黑、旋轉、多格佔位）沒有自己的分類，也不需要:
          // 整份 repo 沒有任何地方在 `buildingId === 0` 的格子上寫它，所以它永遠
          // 跟著建築或設施一起被算到。單獨判它會是一條測不出來的死枝。
          break;
      }

      if (touched) t.cells++;
    }
  }

  return t;
}

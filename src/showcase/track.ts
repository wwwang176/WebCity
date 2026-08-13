import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RailType, TrackDirection } from '../core/rail/types';
import { TrackRenderer } from '../renderer/TrackRenderer';

/**
 * 展示區裡穿過火車站的那條**真的**軌道。
 *
 * 火車站蓋在軌道**上**：`canPlaceTransportStop` 要求那一格 `railType ≠ 0`，
 * 而 `placeTransportStopOnGrid` 只改 buildingId／reserved／zoneType —— 軌道
 * 原封不動留在格子裡，`TrackRenderer` 照樣在同一格畫出碴床、枕木與鋼軌，
 * 貼著格心。所以遊戲裡的鋼軌本來就貫穿車站。
 *
 * 看不到的是**展示區**：那一頁只放建築，沒有 `TrackRenderer`，於是車站中間
 * 那條走廊是一片空的灰帶 —— 而那讓「這一格不畫自己的鐵軌」（BUG-241）
 * 看起來像是漏畫的。
 *
 * 補的是展示區，不是建築：這一格仍然不准自己畫鋼軌，兩份鋼軌永遠對不齊。
 */

/** 鋪幾格。奇數，車站落在正中央那一格；兩端各多鋪幾格才看得出它穿過去。 */
export const TRACK_CELLS = 7;

/** 一條東西向的直線軌道。中間那一格就是車站站的地方。 */
export function showcaseTrackGrid(): Grid {
  const grid = new Grid(TRACK_CELLS, 1);
  for (let x = 0; x < TRACK_CELLS; x++) {
    grid.setCell(x, 0, {
      railType: RailType.STANDARD,
      railFlags: TrackDirection.WEST | TrackDirection.EAST,
    });
  }
  return grid;
}

/**
 * 一組畫好的軌道，中間那一格對準 `slot`。
 *
 * `TrackRenderer` 直接拿格座標當世界座標（格心在整數上），所以整組要往回
 * 位移半條線，中間那一格才落在建築的位置上。
 */
export function createShowcaseTrack(
  slot: { x: number; z: number } = { x: 0, z: 0 },
): THREE.Group {
  const group = new THREE.Group();
  new TrackRenderer().build(group, showcaseTrackGrid());
  group.position.set(slot.x - (TRACK_CELLS - 1) / 2, 0, slot.z);
  return group;
}

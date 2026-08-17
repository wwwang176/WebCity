/**
 * 路面在世界座標的哪個高度。
 *
 * 這些數字原本散在 `RoadRenderer`、`ElevatedRoadRenderer`、`PlacementPreview` 與
 * `vehicleConfig` 各自的檔頭常數裡，而它們必須互相對得上 —— 對不上的時候畫面不會
 * 報錯，只是車子沉進柏油裡（BUG-307 就是這樣來的:車輛擺在板子的**中線**上，而
 * 玩家看到的是板子的**上表面**，於是每一台車都陷進去半塊板子，輪子整個埋掉）。
 */

/** 路面板的厚度。`BoxGeometry(1, 這個, 1)`。 */
export const ROAD_SLAB_THICKNESS = 0.05;

/** 路面板中心擺在哪 —— `setPosition` 用的那個值。板子是置中的幾何。 */
export const ROAD_Y = 0.025;

/**
 * 輪子踩的地方:板子的**上表面**。
 *
 * 任何「站在路上」的東西都用這個，不是 `ROAD_Y`。
 */
export const ROAD_SURFACE_Y = ROAD_Y + ROAD_SLAB_THICKNESS / 2;

/** 人行道那張平面擺在哪。它是平面不是板子，所以自己就是表面。 */
export const SIDEWALK_Y = 0.028;

/** 高架每一層之間的高度。 */
export const LEVEL_HEIGHT = 0.6;

/** 鋼軌本身的厚度。 */
export const RAIL_THICKNESS = 0.015;

/** 鋼軌那條長方體的中心。 */
export const RAIL_Y = 0.035;

/**
 * 火車輪踩的地方:軌頂。
 *
 * 比柏油低 —— 軌道是鋪在道碴上的，兩者本來就不同高。火車跟汽車共用一個高度的話，
 * 一定有一邊是錯的。
 */
export const RAIL_SURFACE_Y = RAIL_Y + RAIL_THICKNESS / 2;

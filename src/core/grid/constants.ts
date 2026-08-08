/**
 * Shared grid geometry constants. Kept in a tiny, dependency-free module so
 * both core (Grid/GridHelpers) and worker bundles can import without pulling
 * in the full grid/building toolchain.
 */

/**
 * Chebyshev distance from a road within which:
 *   (1) a zone cell may be placed (and grow a building),
 *   (2) a civic service may be placed (police/fire/hospital/schools/cemetery),
 *   (3) a covered road tile "picks up" adjacent buildings for service coverage
 *       and citizen commute pathfinding.
 *
 * Reach=1 was the legacy "strictly 4-orthogonal adjacent" behaviour.
 * Reach=2 adds an inner ring one empty tile back from the road, matching the
 * familiar Cities: Skylines style of zoning and service coverage.
 */
export const ZONE_ROAD_REACH = 2;

/**
 * 一格的邊長（公尺）。定義在 `PLANNING.md`：1 格 = 12 m x 12 m。
 *
 * 放在 core 而不是 renderer，是因為它是遊戲世界的事實、不是渲染選擇 ——
 * 建築高度、車輛尺寸、道路寬度都應該以它為準。
 */
export const METRES_PER_CELL = 12;

/**
 * 建築基地的最大寬度（公尺）。**行人路網與建築渲染共用的單一來源。**
 *
 * 行人的門與走道節點放在建築牆面外側 WALKWAY_OFFSET 處，而走道再往外
 * 還要留在格子內。從半格 0.5 往回推：
 *
 *   角節點 <= 0.5 → 門節點 <= 0.47 → 建築半寬 <= 0.41 → 寬度 <= 9.84 m
 *
 * 取 9.8 m。超過這個寬度，行人就會走進建築裡面 —— 而那在畫面上不明顯。
 *
 * 這個數字原本被寫在兩個地方（SidewalkGraph 的 BUILDING_HALF_SIZE 與
 * 渲染層的基地寬度表），兩邊各自漂移不會有任何東西報錯。
 */
export const MAX_BUILDING_WIDTH_M = 9.8;

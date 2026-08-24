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
 * The edge length of one cell in metres. Defined in `PLANNING.md`: 1 cell = 12 m x 12 m.
 *
 * It lives in core rather than the renderer because it is a fact about the game world, not a
 * rendering choice: building heights, vehicle sizes and road widths all measure against it.
 */
export const METRES_PER_CELL = 12;

/**
 * The maximum width of a building footprint in metres. **The single source shared by the
 * pedestrian network and building rendering.**
 *
 * Door and walkway nodes sit WALKWAY_OFFSET outside the building's wall, and the walkway
 * itself still has to stay inside the cell. Working back from a half-cell of 0.5:
 *
 *   corner node <= 0.5 -> door node <= 0.47 -> building half-width <= 0.41 -> width <= 9.84 m
 *
 * Rounded to 9.8 m. Any wider and pedestrians walk through the building, which is not obvious
 * on screen.
 *
 * Split across SidewalkGraph's BUILDING_HALF_SIZE and the renderer's footprint table, the two
 * copies drift apart with nothing reporting it.
 */
export const MAX_BUILDING_WIDTH_M = 9.8;

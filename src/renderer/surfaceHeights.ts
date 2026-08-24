/**
 * The world-space heights of the road surfaces.
 *
 * One module rather than a header constant in each of `RoadRenderer`, `ElevatedRoadRenderer`,
 * `PlacementPreview` and `vehicleConfig`, because the numbers have to agree and nothing reports it
 * when they do not — the cars simply sink into the asphalt. That is BUG-307: vehicles placed on the
 * slab's **mid-line** while the player sees its **top face**, sinking every one of them half a slab
 * and burying the wheels.
 */

/** The road slab's thickness, the middle argument of `BoxGeometry(1, ., 1)`. */
export const ROAD_SLAB_THICKNESS = 0.05;

/** Where the road slab's centre sits, the value passed to `setPosition`. The slab is centred geometry. */
export const ROAD_Y = 0.025;

/**
 * Where the wheels rest: the slab's **top face**.
 *
 * Anything standing on a road uses this rather than `ROAD_Y`.
 */
export const ROAD_SURFACE_Y = ROAD_Y + ROAD_SLAB_THICKNESS / 2;

/** Where the pavement plane sits. It is a plane rather than a slab, so it is its own surface. */
export const SIDEWALK_Y = 0.028;

/** The height between successive elevated levels. */
export const LEVEL_HEIGHT = 0.6;

/** The rail's own thickness. */
export const RAIL_THICKNESS = 0.015;

/** The centre of the rail's box. */
export const RAIL_Y = 0.035;

/**
 * Where train wheels rest: the railhead.
 *
 * Lower than the asphalt, since rails sit on ballast and the two are at different heights. One
 * height shared by trains and cars makes one of them wrong.
 */
export const RAIL_SURFACE_Y = RAIL_Y + RAIL_THICKNESS / 2;

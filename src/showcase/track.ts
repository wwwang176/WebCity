import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { RailType, TrackDirection } from '../core/rail/types';
import { TrackRenderer } from '../renderer/TrackRenderer';

/**
 * The **real** track running through the train station in the showcase.
 *
 * A station is built **on** track: `canPlaceTransportStop` requires `railType != 0` on the cell, and
 * `placeTransportStopOnGrid` changes only buildingId, reserved and zoneType — the track stays
 * untouched in the cell and `TrackRenderer` still draws the ballast, sleepers and rails there, hugging
 * the cell centre. So in game the rails do run through the station.
 *
 * What lacks them is the **showcase**: that page holds buildings only, with no `TrackRenderer`, so
 * the corridor through the middle of the station is an empty grey band — which makes the station not
 * drawing rails of its own (BUG-241) look like an omission.
 *
 * The showcase is what gets the track, not the building: the station still may not draw rails of its
 * own, as two sets of rails would never line up.
 */

/**
 * How many cells of track are laid. Odd, so the station falls on the middle cell.
 *
 * Three is both the floor and the ceiling: one extra cell at each end is what shows the track running
 * **through** rather than stopping at the footprint's edge, and the showcase's spacing is only
 * `CIVIC_LAYOUT_GAP`, 2 cells — one cell longer and the extensions send a rail out through the roof
 * of the building next door.
 */
export const TRACK_CELLS = 3;

/** A straight east-west track. The middle cell is where the station stands. */
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
 * A drawn length of track whose middle cell lines up with `slot`.
 *
 * `TrackRenderer` uses cell coordinates as world coordinates directly, with cell centres on integers,
 * so the whole group is shifted back by half its length to put the middle cell at the building's
 * position.
 */
export function createShowcaseTrack(
  slot: { x: number; z: number } = { x: 0, z: 0 },
): THREE.Group {
  const group = new THREE.Group();
  new TrackRenderer().build(group, showcaseTrackGrid());
  group.position.set(slot.x - (TRACK_CELLS - 1) / 2, 0, slot.z);
  return group;
}

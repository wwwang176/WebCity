import type { GameState } from '../simulation/GameState';

/**
 * How full each facility serving **this cell** is.
 *
 * ## Per cell, not a city-wide average
 *
 * The building panel's warnings (`Hospital over capacity`, `Schools overcrowded` and the rest)
 * were fed by `service.getLoadRatio()`, city-wide demand over city-wide capacity. A hospital
 * overloaded across town raised the warning on this building, and one overloaded next door did
 * not while the city-wide average stayed acceptable. The player saw "the primary school beside
 * me is half empty and the panel says education is overloaded" (the second half of BUG-362).
 *
 * The panel speaks about **this building**. The city-wide figure still exists and the Overview
 * Services page uses it.
 *
 * ## Why this is its own file
 *
 * This lived in `Game.ts`, which imports Three.js directly, so unit tests could not load it and
 * a regression back to the city-wide average would pass the whole suite. Extracted, it can be
 * tested.
 */

/** Each of the five services' per-cell load ratio. `-1` means this cell is uncovered. */
export interface ServiceLoadRatios {
  garbageLoadRatio: number;
  hospitalLoadRatio: number;
  educationLoadRatio: number;
  policeLoadRatio: number;
  fireLoadRatio: number;
}

/**
 * How full the landfill serving this cell is.
 *
 * One term more than the other four: **refuse not yet collected**. It is in no landfill and so
 * not part of `currentLoad`, but it is the problem the player sees — with the landfill half full
 * and refuse piled in the streets, `currentLoad` alone reports everything as fine.
 *
 * The pending amount is city-wide and attributed to the facility serving this cell: failing to
 * collect is that facility's responsibility.
 */
export function garbageLoadRatioAt(state: GameState, x: number, y: number): number {
  const id = state.garbage.getServingFacilityId(x, y);
  if (id === null) return -1;
  const fac = state.garbage.getFacilities().find(f => f.id === id);
  if (!fac) return -1;
  const load = fac.currentLoad + state.garbage.getUncollected();
  if (fac.capacity <= 0) return load > 0 ? Infinity : 0;
  return load / fac.capacity;
}

export function serviceLoadRatiosAt(state: GameState, x: number, y: number): ServiceLoadRatios {
  return {
    garbageLoadRatio: garbageLoadRatioAt(state, x, y),
    hospitalLoadRatio: state.health.getLoadRatioAt(x, y),
    educationLoadRatio: state.education.getLoadRatioAt(x, y),
    policeLoadRatio: state.police.getLoadRatioAt(x, y),
    fireLoadRatio: state.fire.getLoadRatioAt(x, y),
  };
}

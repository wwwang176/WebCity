import type { InfraType } from '../../../core/building/InfraConfig';

/**
 * Civic buildings' representative colours.
 *
 * This is the **primary** signal a player identifies them by. In an isometric view, telling "an L
 * with a watchtower" from "two wings and a link" takes zooming a long way in, while the colour is
 * clear at a glance — so a police station is blue and a fire station red, and that is functional,
 * not decorative.
 *
 * The values are the hex colours the earlier hand-written models used (the `configs` table in
 * `BuildingRenderer.buildCivicBuilding`). Players recognise them already, and replacing them
 * resets recognition to zero.
 *
 * 0..1 triples rather than `0x` integers: the shader multiplies them straight into the lighting,
 * and `ROOF_PALETTE_TABLE` uses the same form. Mixing the two representations means asking which
 * one a table uses before every colour change.
 */
export type CivicColor = readonly [number, number, number];

/** `0xRRGGBB` to a 0..1 triple. Written in hex so it matches the earlier table digit for digit. */
const rgb = (hex: number): CivicColor => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

export const CIVIC_COLORS: Partial<Record<InfraType, CivicColor>> = {
  // ── Everyday services. These six have to stay distinguishable: players see them together
  // most often. ──
  police: rgb(0x3f51b5),        // indigo
  fire: rgb(0xd32f2f),          // fire red
  hospital: rgb(0xe8e8e8),      // medical white
  school: rgb(0x795548),        // brick brown
  school_high: rgb(0x6d4c41),   // dark brick brown
  school_univ: rgb(0x4e342e),   // collegiate dark brown

  // ── Green space ──
  park: rgb(0x4caf50),          // grass green
  cemetery: rgb(0x9e9e9e),      // stone grey

  // ── Utilities. An industrial vocabulary, and their closeness to each other is deliberate:
  // they are one class of thing. ──
  //
  // The landfill's earlier value was identical to the primary school's, both 0x795548. That did
  // not show while their shapes differed sharply; sharing one facade, two brown boxes really do
  // become indistinguishable. Hence an olive-leaning industrial brown.
  garbage: rgb(0x6b6242),
  sewage: rgb(0x607d8b),        // blue grey
  power: rgb(0x8d8d8d),         // plant grey
  /**
   * The water plant takes **the river's colour**.
   *
   * Its hue is aligned directly with the terrain's water (`TERRAIN_COLORS[WATER]` = 0x2196f3),
   * one step darker: the original is water's bright blue in sunlight, which overexposes across a
   * whole wall and leaves the white tanks with nothing to stand out against. `Utility.test.ts`
   * compares the **hue against the terrain water's**, not this hex value: change the terrain's
   * water and that case demands this follow.
   */
  water: rgb(0x2a76b8),         // river blue

  // ── Transit stops ──
  bus_stop: rgb(0xff9800),      // bus orange
  metro_station: rgb(0x2196f3), // metro blue
  train_station: rgb(0x795548), // station brick brown
  ferry_dock: rgb(0x00bcd4),    // water cyan
  airport_s: rgb(0xeceff1),     // terminal white
  airport_m: rgb(0xeceff1),
  airport_l: rgb(0xeceff1),
};

/** The default grey. The earlier `configs` table also fell back to grey, 0x888888. */
export const CIVIC_DEFAULT_COLOR: CivicColor = [0.7, 0.7, 0.7];

/** This civic building type's representative colour. Undefined types return grey rather than undefined. */
export function civicColorOf(type: InfraType): CivicColor {
  return CIVIC_COLORS[type] ?? CIVIC_DEFAULT_COLOR;
}

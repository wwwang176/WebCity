/**
 * The district palette.
 *
 * Hashing a hue from the id by the golden ratio separates districts well but gives the player no
 * choice, and a district's colour is the only cue on the map for which district it is.
 *
 * A swatch stores the **overlay value** (1-100) rather than a hue, because that is what the
 * pipeline speaks: `buildOverlayData` drops 0 (meaning nothing on this cell) and
 * `OverlayRenderer` divides by 100 to get a hue. Storing a hue would need a conversion on each
 * side, and missing one has no symptom beyond the panel's swatch and the map's colour simply
 * differing.
 */

export interface DistrictSwatch {
  /** The overlay value, 1-100. 0 is reserved for a cell in no district. */
  value: number;
  /** The swatch's colour in the panel, the same hue the overlay computes. */
  css: string;
}

/**
 * The saturation and lightness shared by the overlay, the panel swatches and the label
 * backgrounds.
 *
 * Written separately in three places — the overlay's `setHSL(v, 0.7, 0.5)`, the panel's CSS and
 * the label canvas — one adjustment means remembering all three, and missing one has no symptom
 * beyond looking slightly wrong.
 *
 * Saturation is held down to 0.45: a district colour is a background to look at for a long time,
 * not a warning.
 */
export const DISTRICT_COLOR = { saturation: 0.45, lightness: 0.55 } as const;

/** Label backgrounds are one step darker than the swatch, so white text reads against them. */
export const DISTRICT_LABEL_LIGHTNESS = 0.3;

const SATURATION = DISTRICT_COLOR.saturation;
const LIGHTNESS = DISTRICT_COLOR.lightness;

/**
 * Eight hues, deliberately avoiding the 80-150 degree band.
 *
 * That band is the colour of grass. At this saturation a swatch there is nearly invisible on the
 * map: an evenly divided hue circle put two swatches, at 93 and 137 degrees, straight into the
 * grass.
 *
 * Colour is the cue for which district a cell belongs to, and an invisible swatch is one option
 * fewer.
 */
const SWATCH_HUES = [352, 20, 42, 66, 172, 196, 224, 288] as const;

export const DISTRICT_SWATCHES: readonly DistrictSwatch[] = SWATCH_HUES.map((hue) => ({
  // The overlay value is the hue over 3.6. That number is stored rather than the hue because it
  // is what the pipeline speaks.
  value: hue / 3.6,
  css: `hsl(${hue} ${SATURATION * 100}% ${LIGHTNESS * 100}%)`,
}));

/** Whether this index names a swatch. Saves are editable, so out-of-range falls back to the
 *  default. */
export function isValidSwatchIndex(index: number | undefined): boolean {
  return index !== undefined && Number.isInteger(index)
    && index >= 0 && index < DISTRICT_SWATCHES.length;
}

/**
 * The order swatches are handed out in, which is not 0, 1, 2, 3.
 *
 * Districts drawn one after another take consecutively handed-out swatches, and the swatches are
 * ordered by hue: handing them out by index gives the first two districts adjacent hues (352 and
 * 20 degrees), the most similar pair of the eight.
 *
 * This is a bit-reversal order, jumping to the middle of the largest remaining gap each time, so
 * whatever position it stops at, the swatches handed out so far are spread. It is the discrete
 * equivalent of a golden-ratio sequence, which is what the hashed hue was for.
 */
const SWATCH_HANDOUT_ORDER = [0, 4, 2, 6, 1, 5, 3, 7] as const;

/**
 * Which swatch a new district gets.
 *
 * A district needs a colour as soon as it exists. Without one it falls back to a hue hashed from
 * its id, which is not among these eight, may land in the invisible grass band, and cannot be
 * chosen again because it is not a swatch.
 *
 * Unused swatches first; once all eight are taken, the least repeated. A plain modulo keeps
 * stacking onto the same one, and deleting a district should return its colour to the pool.
 */
export function nextSwatchIndex(existing: readonly (number | undefined)[]): number {
  const used = new Array<number>(DISTRICT_SWATCHES.length).fill(0);
  for (const index of existing) {
    // A broken index does not count as taken. Nothing tests this: the search below takes the
    // least used, and a stray key's count is always at least the untouched zeros, so including it
    // changes nothing. It is kept because a different selection rule here — modulo, round-robin,
    // most-used — would start to depend on it.
    if (isValidSwatchIndex(index)) used[index!]!++;
  }
  let best: number = SWATCH_HANDOUT_ORDER[0]!;
  for (const i of SWATCH_HANDOUT_ORDER) {
    if (used[i]! < used[best]!) best = i;
  }
  return best;
}

/** Which swatch the panel draws as selected. `undefined` when none was ever chosen. */
export function swatchCssFor(index: number | undefined): string | undefined {
  return isValidSwatchIndex(index) ? DISTRICT_SWATCHES[index!]!.css : undefined;
}

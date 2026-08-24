import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteFor, roofPaletteFor } from '../ColorPalettes';
import { ZONE_TYPES, LEVELS } from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';

/** Mean lightness: an upgrade should look brighter and cleaner, not merely a different colour. */
function meanLightness(palette: number[]): number {
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  let sum = 0;
  for (const hex of palette) {
    c.setHex(hex);
    c.getHSL(hsl);
    sum += hsl.l;
  }
  return sum / palette.length;
}

/**
 * The hues of the swatches that have a hue at all.
 *
 * Near-neutral greys and whites have no reliable hue — THREE reports 0, which is red — and counting
 * them makes every palette "contain a warm colour". Saturation below 0.12 counts as neutral.
 */
function hues(palette: number[]): number[] {
  return huesOfRgb(palette.map(hexToRgb));
}

/**
 * HSL computed here rather than through `THREE.Color`.
 *
 * Wall colours are hex in sRGB while roof colours are the 0..1 triples the shader uses directly, and
 * `THREE.Color` applies different colour space conversions to the two. Comparing through it turns
 * "the roof is brighter than the wall" into "sRGB is brighter than linear", which is always true.
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const c = max - min;
  if (c < 1e-9) return { h: 0, s: 0, l };
  const s = c / (1 - Math.abs(2 * l - 1));
  const h6 = max === r ? ((g - b) / c + 6) % 6
    : max === g ? (b - r) / c + 2
      : (r - g) / c + 4;
  return { h: h6 / 6, s, l };
}

const hexToRgb = (hex: number): readonly [number, number, number] =>
  [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];

/** As above, but taking the 0..1 triples used on the shader side. */
function huesOfRgb(palette: ReadonlyArray<readonly [number, number, number]>): number[] {
  const out: number[] = [];
  for (const [r, g, b] of palette) {
    const hsl = rgbToHsl(r, g, b);
    if (hsl.s > 0.12) out.push(hsl.h);
  }
  return out;
}

/** One colour set's mean lightness. */
const meanL = (p: ReadonlyArray<readonly [number, number, number]>): number =>
  p.reduce((a, [r, g, b]) => a + rgbToHsl(r, g, b).l, 0) / p.length;

/** The blue band: cyan (0.5) through indigo (0.72). */
const isBlue = (h: number) => h >= 0.5 && h <= 0.72;
/** The warm band: red through yellow (0 to 0.14) and magenta wrapping back round (0.92 to 1). */
const isWarm = (h: number) => h <= 0.14 || h >= 0.92;

describe('paletteFor', () => {
  it('should give every zone and level a non-empty palette', () => {
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(paletteFor(zone, level).length, `zone ${zone} L${level}`).toBeGreaterThan(0);
      }
    }
  });

  it('should not hand the same palette to level 1 and level 3', () => {
    // Part of "an upgrade is only more height": the colour does not improve with it.
    for (const zone of ZONE_TYPES) {
      expect(paletteFor(zone, 1), `zone ${zone}`).not.toEqual(paletteFor(zone, 3));
    }
  });

  it('should make the top level lighter and cleaner than the bottom', () => {
    for (const zone of ZONE_TYPES) {
      expect(meanLightness(paletteFor(zone, 3)), `zone ${zone}`)
        .toBeGreaterThan(meanLightness(paletteFor(zone, 1)));
    }
  });

  it('should fall back rather than return nothing for an unknown zone', () => {
    expect(paletteFor(999, 1).length).toBeGreaterThan(0);
  });
});

describe('zone identity by colour', () => {
  it('should give low-density commercial a blue identity', () => {
    // Warm yellow, brick red, gold and brown make a whole shopping street read as orange.
    for (const level of LEVELS) {
      for (const h of hues(paletteFor(ZoneType.COMMERCIAL_LOW, level))) {
        expect(isBlue(h), `L${level} 牆色相 ${h.toFixed(3)} 不在藍色帶`).toBe(true);
      }
    }
  });

  it('should give low-density commercial roofs a blue identity too', () => {
    // In an isometric view roofs take no less area than walls. Blue walls under terracotta roofs
    // leave the street orange.
    for (const h of huesOfRgb(roofPaletteFor(ZoneType.COMMERCIAL_LOW))) {
      expect(isBlue(h), `屋頂色相 ${h.toFixed(3)} 不在藍色帶`).toBe(true);
    }
  });

  it('should leave the warm zones warm', () => {
    // The counterpart to the case above; without it, painting everything blue would also pass.
    for (const level of LEVELS) {
      for (const h of hues(paletteFor(ZoneType.RESIDENTIAL_LOW, level))) {
        expect(isWarm(h), `住宅低 L${level} 色相 ${h.toFixed(3)} 不再是暖色`).toBe(true);
      }
    }
  });

  it('should give every zone a roof palette', () => {
    for (const zone of ZONE_TYPES) {
      expect(roofPaletteFor(zone).length, `zone ${zone}`).toBeGreaterThan(0);
    }
  });

  it('should keep roofs darker than the walls they sit on', () => {
    // A roof brighter than the walls makes the building read upside down, as if lit from below.
    for (const zone of ZONE_TYPES) {
      expect(meanL(roofPaletteFor(zone)), `zone ${zone} 屋頂比牆亮`)
        .toBeLessThan(meanL(paletteFor(zone, 2).map(hexToRgb)));
    }
  });

  it('should fall back rather than return nothing for an unknown zone', () => {
    expect(roofPaletteFor(999).length).toBeGreaterThan(0);
  });
});

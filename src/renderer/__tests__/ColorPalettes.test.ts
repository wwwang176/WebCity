import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteFor } from '../ColorPalettes';
import { ZONE_TYPES, LEVELS } from '../geometry/buildings/registry';

/** 平均明度：升級應該更亮更乾淨，而不是換個顏色而已。 */
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

describe('paletteFor', () => {
  it('should give every zone and level a non-empty palette', () => {
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(paletteFor(zone, level).length, `zone ${zone} L${level}`).toBeGreaterThan(0);
      }
    }
  });

  it('should not hand the same palette to level 1 and level 3', () => {
    // 這正是「升級只是變高」的一部分：顏色沒有跟著變好。
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

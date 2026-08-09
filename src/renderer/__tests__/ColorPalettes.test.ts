import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteFor, roofPaletteFor } from '../ColorPalettes';
import { ZONE_TYPES, LEVELS } from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';

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

/**
 * 有顏色可言的那些色票的色相。
 *
 * 近乎中性的灰白沒有可靠的色相（THREE 會回傳 0，也就是紅），把它們算進去
 * 會讓任何色盤都「有暖色」。門檻 0.12 以下視為中性。
 */
function hues(palette: number[]): number[] {
  return huesOfRgb(palette.map(hexToRgb));
}

/**
 * 自己算 HSL，不借 `THREE.Color`。
 *
 * 牆色是 hex（sRGB），屋頂色是 shader 直接用的 0..1 三元組，而 `THREE.Color`
 * 對這兩者套用的色彩空間轉換不同 —— 借它來比會把「屋頂比牆亮」比成
 * 「sRGB 比線性亮」，而那恆真。
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

/** 同上，但吃 shader 那一側用的 0..1 三元組。 */
function huesOfRgb(palette: ReadonlyArray<readonly [number, number, number]>): number[] {
  const out: number[] = [];
  for (const [r, g, b] of palette) {
    const hsl = rgbToHsl(r, g, b);
    if (hsl.s > 0.12) out.push(hsl.h);
  }
  return out;
}

/** 一組顏色的平均明度。 */
const meanL = (p: ReadonlyArray<readonly [number, number, number]>): number =>
  p.reduce((a, [r, g, b]) => a + rgbToHsl(r, g, b).l, 0) / p.length;

/** 藍色帶：青(0.5) 到 靛(0.72)。 */
const isBlue = (h: number) => h >= 0.5 && h <= 0.72;
/** 暖色帶：紅橙黃(0 ~ 0.14) 與繞回來的洋紅(0.92 ~ 1)。 */
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

describe('zone identity by colour', () => {
  it('should give low-density commercial a blue identity', () => {
    // 原本是暖黃／磚紅／金／褐 —— 一整條商店街讀起來是橘色的。
    for (const level of LEVELS) {
      for (const h of hues(paletteFor(ZoneType.COMMERCIAL_LOW, level))) {
        expect(isBlue(h), `L${level} 牆色相 ${h.toFixed(3)} 不在藍色帶`).toBe(true);
      }
    }
  });

  it('should give low-density commercial roofs a blue identity too', () => {
    // 等角視角下屋頂佔的面積不比牆少。牆改藍而屋頂留著赤陶瓦，整條街還是橘的。
    for (const h of huesOfRgb(roofPaletteFor(ZoneType.COMMERCIAL_LOW))) {
      expect(isBlue(h), `屋頂色相 ${h.toFixed(3)} 不在藍色帶`).toBe(true);
    }
  });

  it('should leave the warm zones warm', () => {
    // 上一條的對照。少了它，「全部塗成藍的」也會過。
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
    // 屋頂比牆亮的話建築看起來是倒過來的 —— 光從下面來。
    for (const zone of ZONE_TYPES) {
      expect(meanL(roofPaletteFor(zone)), `zone ${zone} 屋頂比牆亮`)
        .toBeLessThan(meanL(paletteFor(zone, 2).map(hexToRgb)));
    }
  });

  it('should fall back rather than return nothing for an unknown zone', () => {
    expect(roofPaletteFor(999).length).toBeGreaterThan(0);
  });
});

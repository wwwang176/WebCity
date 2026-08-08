import * as THREE from 'three';
import { ZoneType } from '../core/grid/types';

// ===== Color Palettes (realistic, zone-distinguishable) =====
const BASE_PALETTES: Record<number, number[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [
    0xf0ece4, // white render
    0xe8e0d0, // warm cream
    0xc47050, // red brick
    0xd4a870, // buff/sandstone
    0xe0d8c8, // pale ivory
    0xb85838, // dark red brick
    0xd8c8a0, // honey stone
    0xe8dcd0, // off-white
    0xc8906c, // salmon brick
    0xd0c4a8, // pale yellow stone
    0xf0e8dc, // bright cream
    0xa86040, // terracotta brick
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    0xe0d4b8, // Paris cream stone
    0xc8c0b0, // warm gray
    0xd8ccac, // pale yellow stone
    0xb87858, // Amsterdam brick
    0xe4dcd0, // off-white plaster
    0xd0c4a0, // honey limestone
    0xc4a880, // sandstone
    0xd8d0c0, // light cream
  ],
  [ZoneType.COMMERCIAL_LOW]:   [
    0xd8c888, // warm yellow
    0xe8e0d0, // white plaster
    0xc87050, // brick red
    0xb8c8d8, // pale blue
    0xd4c4a0, // warm cream
    0xd0b870, // golden
    0xe0d0b8, // light sand
    0xc0a878, // tan
  ],
  [ZoneType.COMMERCIAL_HIGH]:  [
    0x78a8c0, // blue-green glass
    0xc8b890, // warm limestone
    0x88b0a0, // green glass
    0xa0a8b0, // steel gray
    0xd8d4d0, // white modern
    0x90a8b8, // light blue glass
    0xb8a880, // sandstone classic
    0x80a0b8, // teal glass
  ],
  [ZoneType.INDUSTRIAL]:       [
    0xb0b4b8, // silver metal
    0xa86048, // red brick factory
    0xd0ccc8, // white panel
    0xa07050, // rust/corten steel
    0x808480, // dark gray
    0xc0b8b0, // light concrete
    0x907060, // weathered brick
    0xb8b0a0, // beige concrete
  ],
  [ZoneType.OFFICE]:           [
    0x88b0c8, // light blue glass
    0x607890, // deep blue glass
    0xc8ccd0, // white modern
    0xb8a890, // warm stone base
    0x80a8a0, // green glass
    0xa0b4c0, // steel blue
    0x98a8b0, // cool gray
    0x70a0b8, // teal
  ],
};

/**
 * 依等級調整色盤。
 *
 * 等級要看得出「更高級」，不只是更高（規格修訂 4）。色盤是「材質」那一項
 * 最便宜的部分：低等級偏樸素低彩度，高等級偏明亮乾淨。
 *
 * 用調整而不是三份手寫色盤，是為了讓分區的性格（磚紅、石灰、玻璃藍）
 * 在三個等級之間保持一致 —— 換成三份手寫的很容易讓 L3 看起來像別的城市。
 */
const LEVEL_ADJUST: Record<number, { lightness: number; saturation: number }> = {
  1: { lightness: -0.06, saturation: -0.04 },
  2: { lightness: 0, saturation: 0 },
  3: { lightness: 0.07, saturation: 0.03 },
};

const cache = new Map<string, number[]>();

export function paletteFor(zoneType: number, level: number): number[] {
  const key = `${zoneType}:${level}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = BASE_PALETTES[zoneType] ?? [0x888888];
  const adjust = LEVEL_ADJUST[Math.max(1, Math.min(3, level))]!;
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const out = base.map((hex) => {
    c.setHex(hex);
    c.getHSL(hsl);
    c.setHSL(
      hsl.h,
      Math.max(0.02, Math.min(0.7, hsl.s + adjust.saturation)),
      Math.max(0.15, Math.min(0.92, hsl.l + adjust.lightness)),
    );
    return c.getHex();
  });
  cache.set(key, out);
  return out;
}

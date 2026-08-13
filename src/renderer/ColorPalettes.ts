import * as THREE from 'three';
import { ZoneType } from '../core/grid/types';
// `parts` 只 import three 與 core/grid/types，所以這一條不會產生循環。
import {
  FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN,
} from './geometry/buildings/parts';

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
  // 商業低密度是**藍色**的分區。原本是暖黃／磚紅／金／褐，整條商店街讀起來
  // 是橘的，而橘色在這張地圖上已經被住宅低密度的赤陶瓦佔走了。
  [ZoneType.COMMERCIAL_LOW]:   [
    0x8fb0cc, // 鋼藍
    0xdde6ee, // 藍白
    0x5f89b0, // 中藍
    0x3f5f85, // 深靛藍
    0xa8c0d4, // 霧藍
    0x7799b8, // 藍灰
    0x4d7ba6, // 海藍
    0xc3d2de, // 近白偏藍
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
 * 屋頂色盤，`vec3` 的 0..1 三元組 —— shader 直接拿去用，不經 sRGB 轉換。
 *
 * 這張表以前寫死在 `BuildingMaterial` 的 GLSL `getRoofColor` 裡。那裡沒有任何
 * 東西測得到，所以「商業低密度整條街是橘的」只能靠眼睛發現：牆色改了藍，
 * 屋頂還是赤陶瓦 —— 而等角視角下屋頂佔的面積不比牆少。
 *
 * 每個分區的色票**等分** [0, 1)：第 i 個涵蓋 [i/n, (i+1)/n)，由建築位置的
 * 雜湊值挑。所以加減一個色票不必動任何門檻。
 */
export type RoofColor = readonly [number, number, number];

const ROOF_PALETTE_TABLE: Record<number, readonly RoofColor[]> = {
  // 住宅低：陶瓦與板岩
  [ZoneType.RESIDENTIAL_LOW]: [
    [0.35, 0.22, 0.14], // 深褐瓦
    [0.58, 0.30, 0.18], // 赤陶紅
    [0.40, 0.38, 0.36], // 板岩灰
    [0.45, 0.28, 0.16], // 暖褐
    [0.52, 0.34, 0.22], // 杉木褐
    [0.32, 0.30, 0.28], // 深板岩
  ],
  // 住宅高：巴黎鋅板與深板岩
  [ZoneType.RESIDENTIAL_HIGH]: [
    [0.45, 0.45, 0.48], // 鋅灰
    [0.30, 0.30, 0.32], // 深板岩
    [0.38, 0.36, 0.34], // 暖深灰
    [0.35, 0.38, 0.42], // 藍灰板岩
  ],
  // 商業低：藍色分區的屋頂也必須是藍的
  [ZoneType.COMMERCIAL_LOW]: [
    [0.24, 0.29, 0.35], // 深板岩藍
    [0.30, 0.36, 0.43], // 鋅藍
    [0.19, 0.23, 0.29], // 近黑藍
    [0.36, 0.42, 0.49], // 中藍灰
    [0.27, 0.34, 0.42], // 暗鋼藍
  ],
  // 商業高：現代平頂
  [ZoneType.COMMERCIAL_HIGH]: [
    [0.32, 0.34, 0.36], // 深平灰
    [0.38, 0.42, 0.40], // 銅綠
    [0.28, 0.30, 0.32], // 炭灰
  ],
  // 工業：金屬浪板
  [ZoneType.INDUSTRIAL]: [
    [0.55, 0.56, 0.58], // 亮銀
    [0.40, 0.40, 0.42], // 中灰金屬
    [0.50, 0.35, 0.25], // 鏽蝕
    [0.35, 0.36, 0.38], // 暗金屬
  ],
  // 辦公：現代平頂
  [ZoneType.OFFICE]: [
    [0.30, 0.32, 0.35],
    [0.25, 0.28, 0.30],
    [0.35, 0.35, 0.38],
  ],
  // 公家：瀝青防水層與銅綠。公共建築的屋頂偏沉穩，而且常有年份 ——
  // 銅綠是刻意的，一整條街的警局學校全是灰的話認不出它們是公家的。
  [FACADE_CIVIC]: [
    [0.26, 0.27, 0.29], // 深瀝青
    [0.34, 0.34, 0.35], // 中灰防水層
    [0.30, 0.42, 0.38], // 銅綠
    [0.38, 0.36, 0.33], // 舊石棉
  ],
  // 公用設施：鍍鋅浪板與鏽。與工業的色票刻意接近 —— 電廠與水廠本來就是
  // 工業設施，只是歸市府管。
  [FACADE_UTILITY]: [
    [0.48, 0.50, 0.52], // 鍍鋅
    [0.38, 0.39, 0.41], // 舊鍍鋅
    [0.46, 0.33, 0.24], // 鏽紅
  ],
  // 交通：白色薄膜與淺灰金屬。車站屋頂多是輕構造，所以比別人亮。
  [FACADE_TRANSIT]: [
    [0.72, 0.74, 0.76], // 白膜
    [0.58, 0.62, 0.66], // 淺灰金屬
    [0.50, 0.56, 0.62], // 玻璃頂棚
  ],
  // 綠地：木構與綠化屋頂。公園裡有屋頂的東西只有涼亭、管理室、廁所。
  [FACADE_GREEN]: [
    [0.30, 0.22, 0.15], // 深木
    [0.42, 0.30, 0.20], // 杉木
    [0.28, 0.38, 0.22], // 綠化屋頂
  ],
};

const FALLBACK_ROOF: readonly RoofColor[] = [[0.35, 0.35, 0.38]];

/** 這個分區的屋頂色盤。未知分區回傳中灰，不回傳空陣列。 */
export function roofPaletteFor(zoneType: number): readonly RoofColor[] {
  return ROOF_PALETTE_TABLE[zoneType] ?? FALLBACK_ROOF;
}

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

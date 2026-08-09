/**
 * 展示區的三種檢視。重點是「街廓」：重複感只有在一群建築同時出現時才浮現，
 * 單看一棟房子，三個變體也覺得夠用。
 */
import { appearanceOf } from '../renderer/BuildingAppearance';
import {
  LEVELS, TARGET_HEIGHTS_M, heightKey, type Density,
} from '../renderer/geometry/buildings/registry';
import { getMassingVariants, VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { ZoneType } from '../core/grid/types';

export type ViewMode = 'single' | 'block' | 'matrix';

/**
 * 這個分區該用哪一個密度。
 *
 * 只有辦公區兩種密度都有建築。其餘分區配錯密度會拿到**零個變體** —— 畫面上
 * 什麼都沒有，而且不會有任何東西報錯（BUG-227）。階段 2C-1 之前 `getVariants`
 * 根本不看密度，所以配錯只是高度不對，看得出來但不會整片消失。
 */
export function densityFor(zoneType: number, preferred: Density): Density {
  if (TARGET_HEIGHTS_M[heightKey(zoneType, preferred)]) return preferred;
  return TARGET_HEIGHTS_M[heightKey(zoneType, 'LOW')] ? 'LOW' : 'HIGH';
}

export interface PlacedCell {
  x: number;
  z: number;
  zoneType: number;
  density: Density;
  level: number;
  variantIndex: number;
  facadeSeed: readonly [number, number, number];
}

function cellAt(
  zoneType: number, density: Density, level: number, x: number, z: number, seedByte = 0,
): PlacedCell {
  const app = appearanceOf({
    x, y: z, zoneType, level, seedByte,
    variantCount: VARIANT_COUNT,
    paletteSize: 8,
  });
  return { x, z, zoneType, density, level, variantIndex: app.variantIndex, facadeSeed: app.facadeSeed };
}

/** size x size 的同分區同等級街廓，原點置中。 */
export function blockCells(
  zoneType: number, density: Density, level: number, size: number, seedByte = 0,
): PlacedCell[] {
  const half = Math.floor(size / 2);
  const out: PlacedCell[] = [];
  for (let z = -half; z < size - half; z++) {
    for (let x = -half; x < size - half; x++) {
      out.push(cellAt(zoneType, density, level, x, z, seedByte));
    }
  }
  return out;
}

/** 每個 (分區, 等級) 的所有變體排成一列，方便一眼掃過所有組合。 */
export function matrixCells(): PlacedCell[] {
  const out: PlacedCell[] = [];
  let row = 0;
  // 走訪高度表的每個 (分區, 密度)，辦公區的兩種密度才都會出現。
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zoneStr, densityStr] = key.split(':');
    const zoneType = Number(zoneStr);
    const density = densityStr as Density;
    if (zoneType === ZoneType.NONE) continue;
    for (const level of LEVELS) {
      const variants = getMassingVariants(zoneType, density, level);
      for (let i = 0; i < variants.length; i++) {
        out.push({
          x: i * 2, z: row * 2, zoneType, density, level,
          variantIndex: i, facadeSeed: [0.5, 0.5, 0.5],
        });
      }
      row++;
    }
  }
  return out;
}

/**
 * 四方向相鄰、且變體相同的配對，佔所有相鄰配對的比例。
 *
 * 刻意只看 variantIndex 而不看 facadeSeed：剪影相同才是「看起來重複」的
 * 主因，立面差異蓋不掉它。階段 1 只改立面，所以這個數字在階段 1 不會下降
 * —— 那是正確的，不是指標壞了。
 */
export function neighbourSameRatio(cells: PlacedCell[]): number {
  if (cells.length < 2) return 0;
  const byKey = new Map<string, PlacedCell>();
  for (const c of cells) byKey.set(`${c.x},${c.z}`, c);

  let pairs = 0;
  let same = 0;
  for (const c of cells) {
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const n = byKey.get(`${c.x + dx},${c.z + dz}`);
      if (!n) continue;
      pairs++;
      if (n.variantIndex === c.variantIndex && n.zoneType === c.zoneType && n.level === c.level) {
        same++;
      }
    }
  }
  return pairs === 0 ? 0 : same / pairs;
}

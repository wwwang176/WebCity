/**
 * 展示區的三種檢視。重點是「街廓」：重複感只有在一群建築同時出現時才浮現，
 * 單看一棟房子，三個變體也覺得夠用。
 */
import { appearanceOf } from '../renderer/BuildingAppearance';
import { getVariants, ZONE_TYPES, LEVELS } from '../renderer/geometry/buildings/registry';

export type ViewMode = 'single' | 'block' | 'matrix';

export interface PlacedCell {
  x: number;
  z: number;
  zoneType: number;
  level: number;
  variantIndex: number;
  facadeSeed: readonly [number, number, number];
}

function cellAt(zoneType: number, level: number, x: number, z: number, seedByte = 0): PlacedCell {
  const app = appearanceOf({
    x, y: z, zoneType, level, seedByte,
    variantCount: getVariants(zoneType, level).length,
    paletteSize: 8,
  });
  return { x, z, zoneType, level, variantIndex: app.variantIndex, facadeSeed: app.facadeSeed };
}

/** size x size 的同分區同等級街廓，原點置中。 */
export function blockCells(
  zoneType: number, level: number, size: number, seedByte = 0,
): PlacedCell[] {
  const half = Math.floor(size / 2);
  const out: PlacedCell[] = [];
  for (let z = -half; z < size - half; z++) {
    for (let x = -half; x < size - half; x++) {
      out.push(cellAt(zoneType, level, x, z, seedByte));
    }
  }
  return out;
}

/** 每個 (分區, 等級) 的所有變體排成一列，方便一眼掃過所有組合。 */
export function matrixCells(): PlacedCell[] {
  const out: PlacedCell[] = [];
  let row = 0;
  for (const zoneType of ZONE_TYPES) {
    for (const level of LEVELS) {
      const variants = getVariants(zoneType, level);
      for (let i = 0; i < variants.length; i++) {
        out.push({
          x: i * 2, z: row * 2, zoneType, level,
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

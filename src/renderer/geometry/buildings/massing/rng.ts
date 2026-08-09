import { hashCell } from '../../../BuildingAppearance';
import type { Density } from '../registry';

/** 每次呼叫回傳一個新的 [0, 1)。 */
export type Rng = () => number;

/**
 * 一個變體專屬的確定性亂數流。
 *
 * 與 `BuildingAppearance` 的逐格亂數是兩件事：那一條決定「這一格用哪一個變體」，
 * 這一條決定「這個變體長什麼樣」。變體的形狀不可以隨格子改變 —— 幾何是整桶
 * 共用的一份，同一個變體在城市各處必須完全一樣。
 *
 * 四個輸入壓成 `hashCell` 的前兩個參數（都在安全範圍內：分區 1–6、等級 1–3、
 * 變體 0–7、密度 0–1），第四個參數當呼叫計數器用。
 */
export function variantRng(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Rng {
  const a = zoneType * 8 + level;
  const b = variantIndex * 2 + (density === 'HIGH' ? 1 : 0);
  let n = 0;
  return () => hashCell(a, b, 0, n++);
}

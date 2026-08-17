/**
 * Data-driven mapping from overlay types to value-builder functions.
 * Eliminates the switch in Game.ts buildOverlayData (OCP + SRP).
 */
import { OVERLAY_SCALE } from './CoverageOverlay';
import { getGroundwaterLevel } from '../grid/Terrain';
import { DISTRICT_SWATCHES, isValidSwatchIndex } from '../district/DistrictPalette';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/** Minimal cell shape needed by overlay builders. */
export interface OverlayCell {
  zoneType: number;
  pollution: number;
  landValue: number;
  buildingId: number;
}

/** Minimal service interface for overlay building (DIP). */
export interface OverlayBuildContext {
  power: { isPowered(x: number, y: number): boolean; isInCoverage(x: number, y: number): boolean; getSupplyRatio(): number };
  water: { isSupplied(x: number, y: number): boolean; isInCoverage(x: number, y: number): boolean; getSupplyRatio(): number };
  traffic: { getSegmentDensity(key: string): number };
  police: { getCrimeReduction(x: number, y: number): number; getCoverage(x: number, y: number): boolean };
  fire: { getCoverage(x: number, y: number): boolean };
  health: { getCoverage(x: number, y: number): boolean };
  education: { getCoverage(x: number, y: number): boolean };
  parks: { getCoverage(x: number, y: number): boolean };
  garbage: { getCoverage(x: number, y: number): boolean };
  districts: {
    getDistrictAt(x: number, y: number): { id: string; colorIndex?: number } | null;
  };
  policies: { getCrimeBonus(districtId: string | null): number };
  ordinances: { getCrimeBonus(): number };
  /** 住宅格 → 住戶的平均通勤時間（tick）。查不到代表那一格沒有通勤人口。 */
  commuteByHome: ReadonlyMap<string, number>;
  /** 通勤時間超過這個值就是滿格的紅色。 */
  commuteMax: number;
  grid: { getCell(x: number, y: number): { terrainType: number } | null };
}

type OverlayBuilder = (ctx: OverlayBuildContext, cell: OverlayCell, x: number, y: number) => number;

const O = OVERLAY_SCALE;

/** 黃金比例的共軛。乘上它取小數部分，就是那條前 N 項永遠分得最開的低差異序列。 */
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/**
 * 分區在覆蓋層上的數值。渲染端把它當**色相**用（value / 100）。
 *
 * 用流水號走黃金比例展開，不用雜湊。分區 id 的形狀是 `district_${nextId++}`
 * （`recoverNextId` 也是這樣讀的），所以玩家連續畫出來的幾區必然是連號 —— 而
 * 均勻雜湊把連號變成亂數，亂數就會撞在一起：八個分區裡有將近三成機率出現兩個
 * 肉眼分不開的色相。黃金比例序列沒有這個問題，前 N 項就是那 N 個裡分得最開的
 * 一組。
 *
 * 回傳值落在 [1, 100):0 會被 `buildOverlayData` 當成「這一格沒東西」丟掉，而
 * 100 會讓 `setHSL` 的色相繞回 0，跟下限撞色。
 */
export function districtOverlayValue(
  district: { id: string; colorIndex?: number },
): number {
  // 玩家選過顏色就用那一個。色票存的就是圖層數值，不必再換算 —— 換算漏掉
  // 一邊的話，面板上的色塊跟地圖上的顏色就是會不一樣。
  if (isValidSwatchIndex(district.colorIndex)) {
    return DISTRICT_SWATCHES[district.colorIndex!]!.value;
  }
  const id = district.id;
  const cached = DISTRICT_VALUE_CACHE.get(id);
  if (cached !== undefined) return cached;

  const seq = /(\d+)$/.exec(id);
  let n: number;
  if (seq) {
    n = Number(seq[1]);
  } else {
    // 沒有流水號的 id（測試夾具、將來可能的自訂 id）退回雜湊 —— 分不開總比
    // 全部同色好。
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
    n = h;
  }
  const value = 1 + ((n * GOLDEN_RATIO_CONJUGATE) % 1) * 99;
  DISTRICT_VALUE_CACHE.set(id, value);
  return value;
}

/**
 * id → 色值。純函式的記憶表，鍵的數量就是這局出現過的分區數。
 *
 * 這個 builder 是逐格呼叫的:200×200 的地圖如果整張都畫進分區，就是四萬次 regex
 * （實測約 4.8 ms）。雖然只發生在切換圖層或分區改動時、不在每幀路徑上，但那是
 * 重建當幀會多出來的時間。快取之後 regex 的次數等於分區數。
 */
const DISTRICT_VALUE_CACHE = new Map<string, number>();

/**
 * Data-driven overlay value builders. Adding a new overlay type only
 * requires adding an entry here (OCP).
 */
export const OVERLAY_BUILDERS: Record<string, OverlayBuilder> = {
  power: (ctx, cell, x, y) => {
    if (ctx.power.isPowered(x, y)) return O.DISPLAY_MAX; // green: powered (100)
    if (ctx.power.getSupplyRatio() < 1 && ctx.power.isInCoverage(x, y)) return O.DISPLAY_MAX * 0.5; // yellow: in range but underpowered (50)
    if (cell.buildingId > 0) return O.DISPLAY_MAX * 0.15; // red: has building but no coverage (15)
    return 0;
  },

  water: (ctx, cell, x, y) => {
    // Supply status takes priority over groundwater
    if (ctx.water.isSupplied(x, y)) return O.DISPLAY_MAX; // 100: supplied (bright blue)
    if (ctx.water.getSupplyRatio() < 1 && ctx.water.isInCoverage(x, y)) return O.DISPLAY_MAX * 0.5; // 50: undersupplied (yellow)
    if (cell.buildingId > 0) return O.DISPLAY_MAX * 0.15; // 15: no water (red)
    // Groundwater only: cap at 8 so it stays in the deep-blue band (0 < value < 0.1 normalized)
    const gw = getGroundwaterLevel(ctx.grid, x, y);
    return Math.min(8, gw * O.GROUNDWATER_FACTOR * 20);
  },

  zone: (_ctx, cell) =>
    cell.zoneType > 0 ? cell.zoneType * O.ZONE_TYPE_FACTOR : 0,

  traffic: (ctx, _cell, x, y) => {
    const flow = ctx.traffic.getSegmentDensity(`${x},${y}`);
    return flow > 0 ? Math.min(O.DISPLAY_MAX, Math.log2(1 + flow) * O.TRAFFIC_LOG_FACTOR) : 0;
  },

  pollution: (_ctx, cell) =>
    Math.min(O.DISPLAY_MAX, cell.pollution * O.DISPLAY_MAX / O.RAW_MAX),

  landValue: (_ctx, cell) =>
    cell.buildingId > 0 ? Math.min(O.DISPLAY_MAX, cell.landValue * O.DISPLAY_MAX / O.RAW_MAX) : 0,

  crime: (ctx, cell, x, y) => {
    if (cell.buildingId <= 0) return 0;
    const reduction = ctx.police.getCrimeReduction(x, y);
    // 條例算進來 —— 條例上寫著 Crime +12，圖層卻只畫警察局的涵蓋範圍的話，
    // 玩家沒有辦法看見自己剛才買下的代價。
    const districtId = ctx.districts.getDistrictAt(x, y)?.id ?? null;
    const policy = ctx.policies.getCrimeBonus(districtId) + ctx.ordinances.getCrimeBonus();
    return Math.max(0, O.CRIME_BASE + reduction + policy);
  },

  district: (ctx, _cell, x, y) => {
    const d = ctx.districts.getDistrictAt(x, y);
    return d ? districtOverlayValue(d) : 0;
  },

  // Coverage overlays (boolean getCoverage pattern)
  police: (ctx, _cell, x, y) =>
    ctx.police.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  fire: (ctx, _cell, x, y) =>
    ctx.fire.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  health: (ctx, _cell, x, y) =>
    ctx.health.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  education: (ctx, _cell, x, y) =>
    ctx.education.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  park: (ctx, _cell, x, y) =>
    ctx.parks.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  garbage: (ctx, _cell, x, y) =>
    ctx.garbage.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,

  /**
   * 住在這一格的人，通勤平均要多久。
   *
   * 沒有通勤人口的格子回 0（不上色），而不是回滿格 —— 空地與「通勤很短」在
   * 視覺上必須分得開。
   */
  commute: (ctx, _cell, x, y) => {
    const avg = ctx.commuteByHome.get(`${x},${y}`);
    if (avg === undefined) return 0;
    return Math.min(O.DISPLAY_MAX, Math.max(1, (avg / ctx.commuteMax) * O.DISPLAY_MAX));
  },
};

/** Compute the overlay value for a single cell. Returns 0 for unknown/none types. */
export function buildOverlayValue(
  ctx: OverlayBuildContext,
  type: string,
  cell: OverlayCell,
  x: number,
  y: number,
): number {
  const builder = OVERLAY_BUILDERS[type];
  return builder ? builder(ctx, cell, x, y) : 0;
}

/**
 * 圖層上每個分區的名稱要標在哪裡。
 *
 * 取格子座標的平均。沒有格子的分區不給標籤 —— 硬算會得到 NaN，標籤會飛到畫面外。
 */
export function districtLabelAnchors(
  districts: readonly { id: string; name: string; cells: ReadonlySet<string> }[],
): { id: string; name: string; x: number; y: number }[] {
  const out: { id: string; name: string; x: number; y: number }[] = [];
  for (const d of districts) {
    if (d.cells.size === 0) continue;
    let sx = 0, sy = 0;
    for (const key of d.cells) {
      const { x, y } = parsePosKeyUnsafe(key);
      sx += x; sy += y;
    }
    out.push({
      id: d.id, name: d.name,
      x: Math.round(sx / d.cells.size),
      y: Math.round(sy / d.cells.size),
    });
  }
  return out;
}

import * as THREE from 'three';
import { placeCivicPlan, type CivicTris, type PlacedCivic }
  from '../renderer/geometry/civic/place';
import { CIVIC_TRIANGLE_BUDGET, type CivicPlan, type Footprint }
  from '../renderer/geometry/civic/types';

/**
 * 展示區的公共建築檢視。
 *
 * 擺放本身在 `renderer/geometry/civic/place.ts` —— 遊戲與展示區共用同一份，
 * 那是「展示區看到的就是出貨的東西」成立的唯一方式。這裡只剩展示區自己的
 * 那一層：三角形預算的報告。
 */

export type { CivicTris, PlacedCivic };
export { allMeshes } from '../renderer/geometry/civic/place';

export interface CivicReport {
  cells: number;
  budget: CivicTris;
  over: Record<keyof CivicTris, boolean>;
}

/**
 * 這棟建築的三角形預算與超支狀況。
 *
 * 預算逐**格**算：分區建築一格一棟，所以逐棟的上限有意義；公共建築佔 4 到
 * 54 格，套同一條線的話不是大型建築整片標紅，就是小型建築怎麼做都不會紅。
 *
 * 四層各自判斷 —— 一個總開關的話「哪一層超支」只能用猜的。
 */
export function civicTriangleReport(footprint: Footprint, tris: CivicTris): CivicReport {
  const cells = footprint.w * footprint.h;
  const budget: CivicTris = {
    massing: CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * cells,
    decal: CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL * cells,
    // 矮物件是**基礎 + 斜率**，其餘三層是純逐格 —— 一格的公園整塊基地
    // 就是矮物件，逐格的線在那裡不成立（見 `CIVIC_TRIANGLE_BUDGET`）。
    prop: CIVIC_TRIANGLE_BUDGET.PROP_BASE
      + CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL * cells,
    overhead: CIVIC_TRIANGLE_BUDGET.OVERHEAD_PER_CELL * cells,
  };
  return {
    cells,
    budget,
    over: {
      massing: tris.massing > budget.massing,
      decal: tris.decal > budget.decal,
      prop: tris.prop > budget.prop,
      overhead: tris.overhead > budget.overhead,
    },
  };
}

/**
 * 把一棟公共建築放進展示區的場景。
 *
 * `occupancy` 在公共建築上是「有沒有電」，由展示區的滑桿頂替（見
 * `BUILDING_FRAG` 的 `powered`）。
 */
export function placeCivic(
  plan: CivicPlan, scene: THREE.Scene, occupancy: number,
  slot: { x: number; z: number } = { x: 0, z: 0 },
): PlacedCivic {
  return placeCivicPlan(plan, scene, { occupancy, slot });
}

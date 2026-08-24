import * as THREE from 'three';
import { placeCivicPlan, type CivicTris, type PlacedCivic }
  from '../renderer/geometry/civic/place';
import { CIVIC_TRIANGLE_BUDGET, type CivicPlan, type Footprint }
  from '../renderer/geometry/civic/types';

/**
 * The showcase's civic buildings view.
 *
 * The placement itself lives in `renderer/geometry/civic/place.ts`, shared by the game and the
 * showcase, which is the only way what the showcase shows is what ships. What remains here is the
 * showcase's own layer: the triangle budget report.
 */

export type { CivicTris, PlacedCivic };
export { allMeshes } from '../renderer/geometry/civic/place';

export interface CivicReport {
  cells: number;
  budget: CivicTris;
  over: Record<keyof CivicTris, boolean>;
}

/**
 * One building's triangle budget and whether it is over.
 *
 * The budget counts per **cell**: a zoned building is one per cell, so a per-building limit is
 * meaningful, while civic buildings occupy 4 to 54 cells and one line for all of them either marks
 * every large building red or never marks a small one.
 *
 * Each of the four layers is judged separately; under a single switch, which one is over budget is
 * guesswork.
 */
export function civicTriangleReport(footprint: Footprint, tris: CivicTris): CivicReport {
  const cells = footprint.w * footprint.h;
  const budget: CivicTris = {
    massing: CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * cells,
    decal: CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL * cells,
    // Ground props are a **base plus a slope** while the other three are purely per cell: a one-cell
    // park is ground props across its whole plot, where a per-cell line does not hold (see
    // `CIVIC_TRIANGLE_BUDGET`).
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
 * Places one civic building into the showcase's scene.
 *
 * On a civic building `occupancy` means whether it has power, stood in for by the showcase's slider
 * (see `powered` in `BUILDING_FRAG`).
 */
export function placeCivic(
  plan: CivicPlan, scene: THREE.Scene, occupancy: number,
  slot: { x: number; z: number } = { x: 0, z: 0 },
): PlacedCivic {
  return placeCivicPlan(plan, scene, { occupancy, slot });
}

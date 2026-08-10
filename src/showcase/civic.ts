import * as THREE from 'three';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../renderer/geometry/buildings/parts';
import { GROUND_LAYERS } from '../renderer/geometry/buildings/propBands';
import {
  assembleCivic, assembleDecals, assemblePlants,
} from '../renderer/geometry/civic/assemble';
import { civicTypesDone } from '../renderer/geometry/civic/registry';
import { CIVIC_TRIANGLE_BUDGET, type CivicPlan, type Footprint }
  from '../renderer/geometry/civic/types';
import { getInfraConfig, type InfraType } from '../core/building/InfraConfig';
import { stampInstanceValues } from './instanceAttrs';

/**
 * 展示區的公共建築檢視。
 *
 * 與分區建築那一條路徑（`main.ts` 的 `place`）刻意保持同一個形狀：同一個
 * 材質單例、同一組逐實例屬性、同一套四層。差別只在量體來源是 `CivicPlan`
 * 而不是量體生成器，以及三角形預算是逐格而不是逐棟。
 */

/** 一次繪製的四層三角形數。 */
export interface CivicTris {
  massing: number;
  decal: number;
  prop: number;
  overhead: number;
}

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
    prop: CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL * cells,
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

export interface CivicOption {
  type: InfraType;
  label: string;
}

/**
 * 下拉選單要列的種類。
 *
 * 只列**已經改造完成**的 —— 列出還沒改的話，選了會是一片空地而不會報錯，
 * 看起來像「壞了」而不像「還沒做」。
 *
 * 名稱取 `InfraConfig` 的，不另寫一份：手寫第二份表的話，改了遊戲裡的名字
 * 選單不會跟著改。
 */
export function civicOptions(): CivicOption[] {
  return civicTypesDone().map((type) => {
    const cfg = getInfraConfig(type);
    const name = cfg?.name ?? type;
    const size = cfg ? `${cfg.width}×${cfg.height}` : '?';
    return { type, label: `${name}（${size}）` };
  });
}

/**
 * 每一層各自的擺放規則。與 `main.ts` 的 `ATTACHMENTS` 逐項對應。
 *
 * 植栽自己一個 mesh 但算在 `prop` 的預算裡：樹冠是圓錐、灌木是球（索引、
 * 帶 uv），量體走 `shapeOf`（非索引、無 uv），`mergeGeometries` 併不起來 ——
 * 所以是兩個 mesh。但它們就是矮物件，沒有理由有第二個預算。
 */
const LAYERS: ReadonlyArray<{
  /** 這一層的三角形算進哪一格預算。 */
  key: keyof CivicTris;
  build: (plan: CivicPlan) => THREE.BufferGeometry;
  castShadow: boolean;
  /** 遠景時整層關掉。貼片不關 —— 它撐住「地面有東西」的觀感。 */
  culled: boolean;
  /** 貼片的幾何自己帶著絕對高度，其餘從建築底面起算。 */
  baseY: number;
}> = [
  {
    key: 'decal', castShadow: false, culled: false, baseY: 0,
    build: p => assembleDecals(p.decals, p.footprint),
  },
  {
    key: 'massing', castShadow: true, culled: false, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.massing, p.footprint, p.color),
  },
  {
    key: 'prop', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.props, p.footprint, p.color),
  },
  {
    key: 'prop', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assemblePlants(p.plants, p.footprint),
  },
  {
    key: 'overhead', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.overhead, p.footprint, p.color),
  },
];

export interface PlacedCivic {
  meshes: THREE.Mesh[];
  /** 遠景時要關掉的那些。`main.ts` 的 `DetailVisibility` 吃它。 */
  culled: THREE.Mesh[];
  tris: CivicTris;
}

/**
 * 把一棟公共建築放進場景。
 *
 * `occupancy` 由展示區的滑桿頂替遊戲的實際使用率。**四層都要餵**
 * `stampInstanceValues` —— 只餵量體層的話，矮物件上的路燈與招牌永遠不亮
 * （BUG-230c 就是這個形狀）。
 */
export function placeCivic(
  plan: CivicPlan, scene: THREE.Scene, occupancy: number,
): PlacedCivic {
  const material = getBuildingMaterial();
  const out: PlacedCivic = {
    meshes: [], culled: [],
    tris: { massing: 0, decal: 0, prop: 0, overhead: 0 },
  };

  for (const layer of LAYERS) {
    const geo = layer.build(plan);
    if (geo.getAttribute('position').count === 0) {
      geo.dispose();
      continue;
    }
    stampZoneCategory(geo, ZONE_CAT[plan.facade] ?? 0);
    stampInstanceValues(geo, { occupancy, seed: plan.seed });

    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = layer.castShadow;
    mesh.receiveShadow = true;
    mesh.position.set(0, layer.baseY, 0);
    scene.add(mesh);

    out.meshes.push(mesh);
    if (layer.culled) out.culled.push(mesh);
    // `+=` 而不是 `=` —— 植栽與矮物件共用 `prop` 這一格。
    out.tris[layer.key] += triangleCount(geo);
  }

  return out;
}

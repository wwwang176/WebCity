import * as THREE from 'three';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../renderer/geometry/buildings/parts';
import { GROUND_LAYERS } from '../renderer/geometry/buildings/propBands';
import {
  assembleCivic, assembleDecals, assembleFixtures, assembleVehicles,
} from '../renderer/geometry/civic/assemble';
import { createVehicleMaterial } from '../renderer/vehicleMaterial';
import { CIVIC_TRIANGLE_BUDGET, type CivicPlan, type Footprint }
  from '../renderer/geometry/civic/types';
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
 * 每一層各自的擺放規則。與 `main.ts` 的 `ATTACHMENTS` 逐項對應。
 *
 * 共用矮物件自己一個 mesh 但算在 `prop` 的預算裡：那些圖元是圓錐、球、環
 * （索引、帶 uv），量體走 `shapeOf`（非索引、無 uv），`mergeGeometries`
 * 併不起來 —— 所以是兩個 mesh。但它們就是矮物件，沒有理由有第二個預算。
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
    build: p => assembleFixtures(p.fixtures, p.footprint),
  },
  {
    key: 'overhead', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.overhead, p.footprint, p.color),
  },
];

/**
 * 停放的車輛用的材質。
 *
 * 一份就夠 —— 展示區一次只畫一棟建築。實體在 `renderer/vehicleMaterial`，
 * 與 `VehicleRenderer` 共用同一個工廠：各寫一份的話，哪天有人替車輛改了
 * 材質，停在停車場的那幾台會靜靜地留在舊的樣子。
 */
let vehicleMaterial: THREE.MeshLambertMaterial | null = null;

export interface PlacedCivic {
  /**
   * 走建築 shader 的那些層（貼片、量體、矮物件、懸挑）。
   *
   * 與 `vehicles` **在型別上分開**，不是分類上的潔癖：這一批全部要餵
   * `stampZoneCategory` 與 `stampInstanceValues`，而車輛**絕對不能**被餵
   * —— 那兩個會蓋掉 `color` 裡真正的 RGB。混在同一個陣列裡的話，總有一天
   * 有人寫一個 `for (const m of meshes)` 就把警車變成一塊灰。
   */
  building: THREE.Mesh[];
  /** 停放的車輛。走車輛材質。沒有車時是 `null`。 */
  vehicles: THREE.Mesh | null;
  /** 遠景時要關掉的那些。`main.ts` 的 `DetailVisibility` 吃它。 */
  culled: THREE.Mesh[];
  tris: CivicTris;
}

/** 場景裡所有的 mesh —— 呼叫端要一次清乾淨時用。 */
export function allMeshes(p: PlacedCivic): THREE.Mesh[] {
  return p.vehicles ? [...p.building, p.vehicles] : [...p.building];
}

/**
 * 把一棟公共建築放進場景。
 *
 * `occupancy` 在公共建築上是「有沒有電」，由展示區的滑桿頂替（見
 * `BUILDING_FRAG` 的 `powered`）。**每一層都要餵** `stampInstanceValues`
 * —— 只餵量體層的話，矮物件上的路燈永遠不亮（BUG-230c 就是這個形狀）。
 *
 * `slot` 是這一棟在展示區裡的佔地中心（格）。plan 的座標一律以自己的中心為
 * 原點，所以擺放時整棟平移 —— **每一層都要**，車輛最容易漏（它不走那個
 * 迴圈），而漏掉的那一層會留在原點，看起來像「某一棟的車停到別人家去了」。
 */
export function placeCivic(
  plan: CivicPlan, scene: THREE.Scene, occupancy: number,
  slot: { x: number; z: number } = { x: 0, z: 0 },
): PlacedCivic {
  const material = getBuildingMaterial();
  const out: PlacedCivic = {
    building: [], vehicles: null, culled: [],
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
    mesh.position.set(slot.x, layer.baseY, slot.z);
    scene.add(mesh);

    out.building.push(mesh);
    if (layer.culled) out.culled.push(mesh);
    // `+=` 而不是 `=` —— 共用矮物件與自訂矮物件共用 `prop` 這一格。
    out.tris[layer.key] += triangleCount(geo);
  }

  // 停放的車輛。**不走上面那個迴圈** —— 它們用車輛材質，而且不能被
  // `stampZoneCategory` / `stampInstanceValues` 碰：那兩個會蓋掉 `color`
  // 裡真正的 RGB，把一台白藍相間的警車變成一塊灰。
  const vehicleGeo = assembleVehicles(plan.vehicles, plan.footprint);
  if (vehicleGeo.getAttribute('position').count > 0) {
    vehicleMaterial ??= createVehicleMaterial();
    const vmesh = new THREE.Mesh(vehicleGeo, vehicleMaterial);
    vmesh.castShadow = true;
    vmesh.receiveShadow = true;
    vmesh.position.set(slot.x, GROUND_LAYERS.BUILDING, slot.z);
    scene.add(vmesh);
    out.vehicles = vmesh;
    // 車跟著遠景一起關掉 —— 它與矮物件是同一個尺度的東西。
    out.culled.push(vmesh);
  } else {
    vehicleGeo.dispose();
  }

  return out;
}

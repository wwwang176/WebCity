import * as THREE from 'three';
import { getBuildingMaterial } from '../../BuildingMaterial';
import { createVehicleMaterial } from '../../vehicleMaterial';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../buildings/parts';
import { GROUND_LAYERS } from '../buildings/propBands';
import {
  assembleCivic, assembleDecals, assembleFixtures, assembleVehicles,
} from './assemble';
import { stampInstanceValues } from './instanceAttrs';
import type { CivicPlan } from './types';

/**
 * 把一份 `CivicPlan` 畫成一組 mesh。
 *
 * 遊戲（`BuildingRenderer.buildModel`）與展示區（`showcase/civic.ts`）共用
 * 這一份。原本只有展示區有，而遊戲走的是另一條完全獨立的路徑 —— 手寫的
 * `MeshLambertMaterial` 加實心 `BoxGeometry`，沒有窗戶也沒有夜間亮窗
 * （BUG-238）。兩條路各畫各的，結果是同一棟建築在兩個地方長得不一樣，
 * 而「展示區看到的就是出貨的東西」是展示區唯一的價值。
 */

/** 一次繪製的四層三角形數。 */
export interface CivicTris {
  massing: number;
  decal: number;
  prop: number;
  overhead: number;
}

/**
 * 每一層各自的擺放規則。
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
 * 實體在 `renderer/vehicleMaterial`，與 `VehicleRenderer` 共用同一個工廠：
 * 各寫一份的話，哪天有人替車輛改了材質，停在停車場的那幾台會靜靜地留在
 * 舊的樣子。
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
  /** 遠景時要關掉的那些。 */
  culled: THREE.Mesh[];
  tris: CivicTris;
}

/** 場景裡所有的 mesh —— 呼叫端要一次清乾淨時用。 */
export function allMeshes(p: PlacedCivic): THREE.Mesh[] {
  return p.vehicles ? [...p.building, p.vehicles] : [...p.building];
}

export interface PlaceOptions {
  /**
   * 0..1，這一棟的「有沒有在運作」。餵進 `aOccupancy`，而 shader 拿它當
   * `powered` —— 0 的話夜裡一扇燈都不會亮。
   */
  occupancy?: number;
  /** 這一棟在世界裡的佔地中心（格）。畫進 group 的話留 0，讓 group 去位移。 */
  slot?: { x: number; z: number };
}

/**
 * 把一棟公共建築放進 `container`。
 *
 * `container` 收 `THREE.Object3D` 而不是 `Scene`：遊戲裡每一棟是一個帶著
 * 位置與旋轉的 `Group`，而展示區直接丟進場景。
 *
 * **每一層都要餵** `stampInstanceValues` —— 只餵量體層的話，矮物件上的路燈
 * 永遠不亮（BUG-230c 就是這個形狀）。
 *
 * plan 的座標一律以自己的中心為原點，所以 `slot` 是整棟平移 —— **每一層
 * 都要**，車輛最容易漏（它不走那個迴圈），而漏掉的那一層會留在原點，
 * 看起來像「某一棟的車停到別人家去了」。
 */
export function placeCivicPlan(
  plan: CivicPlan, container: THREE.Object3D, opts: PlaceOptions = {},
): PlacedCivic {
  const material = getBuildingMaterial();
  const occupancy = opts.occupancy ?? 1;
  const slot = opts.slot ?? { x: 0, z: 0 };
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
    container.add(mesh);

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
    container.add(vmesh);
    out.vehicles = vmesh;
    // 車跟著遠景一起關掉 —— 它與矮物件是同一個尺度的東西。
    out.culled.push(vmesh);
  } else {
    vehicleGeo.dispose();
  }

  return out;
}

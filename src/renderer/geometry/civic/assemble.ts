import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapeOf } from '../buildings/massing/assemble';
import { partOf, type Volume } from '../buildings/massing/volume';
import { GROUND_LAYERS } from '../buildings/massing/metrics';
import {
  tagPart, setGroundShade, PART_WALL, PART_GROUND, PART_FOLIAGE, PART_WATER,
} from '../buildings/parts';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import {
  CIVIC_INSET,
  type CivicDecal, type CivicVolume, type CivicVehicle, type CivicVehicleKind,
  type Footprint,
} from './types';
import { CIVIC_DEFAULT_COLOR, type CivicColor } from './colors';
import { VEHICLE_CONFIG } from '../../vehicleConfig';
import { propGeometry, propExtent, type PropSpec } from '../props';
import {
  buildCarGeometry, buildBusGeometry, buildTruckGeometry, buildFiretruckGeometry,
  buildPoliceCarGeometry, buildAmbulanceGeometry, buildGarbageTruckGeometry,
  buildVanGeometry, buildAirplaneGeometry, buildAirplaneVTailGeometry,
  buildFerryGeometry,
} from '../index';

/**
 * 公共建築的量體與貼片組裝。
 *
 * 圖元（`frustum` / `cylinder` / `shapeOf`）全部沿用 `buildings/massing`，
 * 這裡只換護欄與貼片的產生方式。各寫一份圖元的下場這個專案已經示範過
 * （BUG-231 的地板顏色兩份、BUG-231 之後才收斂）。
 */

/**
 * `mergeGeometries`，但失敗時**丟例外**而不是回傳 null。
 *
 * three.js 的 `mergeGeometries` 在屬性集合不一致時只印一行 `console.error`
 * 然後回傳 null —— 不丟例外。所以原本那個 `mergeGeometries(parts)!` 是在對
 * TypeScript 說謊，而 null 會一路傳到 `new THREE.Mesh(geo, mat)` 才炸，
 * 離現場很遠。
 *
 * 它真的發生過：機場把**飛機**（`position,normal,color`）與公車
 * （`position,normal,color,uv`）停在同一塊地上，合併回傳 null，而每一條測試
 * 都是綠的 —— 資料表測的是「不得丟例外」，而它真的沒丟。只有在瀏覽器裡開起來
 * 才看得到。
 *
 * 訊息裡列出每一份的屬性集合：光說「合併失敗」的話，下一個人要自己去找是哪
 * 一份不一樣。
 */
export function mergeOrThrow(
  parts: THREE.BufferGeometry[], what: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (merged) return merged;
  const sets = parts.map((g, i) => `#${i} {${Object.keys(g.attributes).sort().join(',')}}`);
  throw new Error(
    `${what} 的幾何合併失敗 —— 屬性集合不一致：${sets.join(' ')}`,
  );
}

/** 空的但**有頂點色**的幾何。少了頂點色，shader 會把它當成 partType 0。 */
function emptyTagged(part: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  tagPart(geo, part);
  tagColor(geo, CIVIC_DEFAULT_COLOR);
  return geo;
}

/**
 * 把建築色攤到每個頂點上（`aBldgColor`）。
 *
 * 逐**量體**寫而不是最後整份寫：醫院的紅十字、大學的金頂是單獨一塊量體的
 * 顏色，而合併之後就分不出誰是誰了。與 `tagPart` 完全同一個道理。
 */
function tagColor(geo: THREE.BufferGeometry, c: CivicColor): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('aBldgColor', new THREE.BufferAttribute(arr, 3));
}

/** 離佔地中心的最大距離，逐軸。非置中的量體會單邊外凸，寬度看不出來。 */
function extentOf(v: Volume): { x: number; z: number } {
  return {
    x: Math.max(Math.abs(v.x - v.w / 2), Math.abs(v.x + v.w / 2)),
    z: Math.max(Math.abs(v.z - v.d / 2), Math.abs(v.z + v.d / 2)),
  };
}

/**
 * 量體越出佔地就丟例外。
 *
 * 與分區版 `assemble()` 的護欄是**不同的東西**：那邊擋的是行人包絡線
 * （格內的概念，門節點放在它外側，越過就是行人穿牆 BUG-221）。公共建築
 * 佔好幾格，包絡線不適用 —— 它要擋的是「壓到鄰格的建築或馬路」。
 *
 * 逐軸量而不是取單一半徑：2×3 的醫院在 z 方向有 3 格可用、x 方向只有 2 格。
 * 取單一半徑的話，不是浪費掉長邊就是讓短邊溢出。
 *
 * 量離中心的最大距離而不是包圍盒寬度：偏心的量體會單邊外凸，而寬度看不出來
 * —— 那是 BUG-222 的形狀。
 */
function assertInside(volumes: readonly Volume[], footprint: Footprint, inset: number): void {
  const limX = footprint.w / 2 - inset;
  const limZ = footprint.h / 2 - inset;
  let over = 0;
  for (const v of volumes) {
    const e = extentOf(v);
    over = Math.max(over, e.x - limX, e.z - limZ);
  }
  if (over > 1e-6) {
    throw new Error(
      `量體超出佔地 ${(over * METRES_PER_CELL).toFixed(3)} m —— 會壓到鄰格`,
    );
  }
}

/** 公共建築的量體轉幾何。越出佔地時丟例外。 */
export function assembleCivic(
  volumes: readonly CivicVolume[], footprint: Footprint, baseColor: CivicColor,
): THREE.BufferGeometry {
  assertInside(volumes, footprint, CIVIC_INSET);

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      // **在 tagPart 之後。** `tagPart` 會重建整份 color 屬性（三個通道一起
      // 歸零），所以順序反過來的話明度會被靜靜抹掉。
      if (v.shade !== undefined) setGroundShade(g, v.shade);
      tagColor(g, v.color ?? baseColor);
      parts.push(g);
    }
  }
  // 公園可能完全沒有量體（只有貼片與樹）。空陣列丟給 mergeGeometries 會回傳
  // null，而 null 一路傳到 `new THREE.Mesh` 才炸 —— 離現場很遠。
  if (parts.length === 0) return emptyTagged(PART_WALL);
  return mergeOrThrow(parts, '量體');
}

const layerY = (d: CivicDecal) =>
  (d.layer === 'mark' ? GROUND_LAYERS.MARKING : GROUND_LAYERS.DECAL);

/**
 * 貼片轉向之後的軸對齊包絡線，寫成零高度的量體給 `assertInside` 吃。
 *
 * 一個 w × d 的矩形轉 θ 之後的包絡線是
 * （w|cosθ| + d|sinθ|）×（w|sinθ| + d|cosθ|）—— 中心不變。
 */
function turnedBounds(d: CivicDecal): Volume {
  const c = Math.abs(Math.cos(d.rotationY ?? 0));
  const s = Math.abs(Math.sin(d.rotationY ?? 0));
  return {
    x: d.x, z: d.z,
    w: d.w * c + d.d * s,
    d: d.w * s + d.d * c,
    y0: 0, y1: 0,
  };
}

/** 兩塊貼片的水平交集面積。共邊（接觸）回傳 0。 */
function overlapArea(a: CivicDecal, b: CivicDecal): number {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  return ox > 1e-6 && oz > 1e-6 ? ox * oz : 0;
}

/**
 * 貼片轉幾何。
 *
 * 貼片**不吃 `CIVIC_INSET`** —— 它是平的鋪面，鋪到格子邊界是對的：人行道
 * 本來就一路鋪到路邊。但它仍然不得越出佔地。
 */
export function assembleDecals(
  decals: readonly CivicDecal[], footprint: Footprint,
): THREE.BufferGeometry {
  for (const d of decals) {
    if (d.rotationY && (d.layer ?? 'base') === 'base') {
      throw new Error(
        '只有標線層可以轉向 —— 底層的重疊檢查是軸對齊矩形的交集，'
        + '轉過的底層會讓它靜靜地算錯，兩塊其實重疊的鋪面會被放行',
      );
    }
  }

  // 借量體的護欄：把貼片當成零高度的量體，護欄的算術完全一樣。
  // 轉過的標線要用**轉向之後**的包絡線 —— 用原本的長寬檢查的話，一條沿 x
  // 剛好放得下的線轉 90 度之後會伸進隔壁的格子而沒有人擋。
  assertInside(decals.map(turnedBounds), footprint, 0);

  // 底層彼此不得重疊。標線層可以疊在鋪面上，也可以彼此疊（停車格線畫在
  // 入口踏板上）—— 因為它們高度不同，或本來就是設計成疊的。
  const base = decals.filter(d => (d.layer ?? 'base') === 'base');
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const area = overlapArea(base[i]!, base[j]!);
      if (area > 0) {
        throw new Error(
          `底層貼片重疊 ${(area * METRES_PER_CELL * METRES_PER_CELL).toFixed(2)} m2`
          + ' —— 兩塊同高的四邊形會 z-fighting，靜止時看不出來、一移動鏡頭就閃',
        );
      }
    }
  }

  const parts = decals.map((d) => {
    const geo = new THREE.PlaneGeometry(d.w, d.d);
    geo.rotateX(-Math.PI / 2);   // 朝上。材質是 FrontSide，朝下就完全看不到。
    // **轉在平移之前** —— 反過來的話它會繞原點轉，整條跑道會甩到別的地方去。
    if (d.rotationY) geo.rotateY(d.rotationY);
    geo.translate(d.x, layerY(d), d.z);
    tagPart(geo, d.lawn ? PART_FOLIAGE : d.water ? PART_WATER : PART_GROUND);
    setGroundShade(geo, d.shade);
    // 貼片的顏色由 PART_GROUND / PART_FOLIAGE 的分支決定，不吃 aBldgColor。
    // 仍然要寫：屬性缺席時 WebGL 一律餵 0，而 `isFloor` 分支會讀到它。
    tagColor(geo, CIVIC_DEFAULT_COLOR);
    return geo;
  });

  if (parts.length === 0) return emptyTagged(PART_GROUND);
  return mergeOrThrow(parts, '貼片');
}

/**
 * 共用矮物件轉幾何。
 *
 * 自己一層，不與 `assembleCivic` 的產物合併 —— 這些圖元用 `THREE` 的圓錐、
 * 球、環（索引、帶 uv），量體是 `shapeOf` 的稜台（非索引、無 uv），
 * `mergeGeometries` 要求屬性集合一致，兩者併不起來。
 *
 * 護欄與量體同一條：越出佔地就丟例外。範圍取自 `propExtent`，它逐軸回報
 * 半寬 —— 少報的話東西會伸出去壓到鄰格。
 */
export function assembleFixtures(
  fixtures: readonly PropSpec[], footprint: Footprint,
): THREE.BufferGeometry {
  assertInside(
    fixtures.map((p) => {
      const e = propExtent(p);
      return { x: p.x, z: p.z, w: e.x * 2, d: e.z * 2, y0: 0, y1: 0 };
    }),
    footprint,
    CIVIC_INSET,
  );

  const parts = fixtures.flatMap(propGeometry);
  if (parts.length === 0) return emptyTagged(PART_FOLIAGE);
  return mergeOrThrow(parts, '共用矮物件');
}

/**
 * 車種 → `VEHICLE_CONFIG` 的鍵。
 *
 * 兩邊的命名不一樣（`policeCar` 對 `police_car`），所以需要這張表 —— 但它
 * 只是改名，顏色仍然由 `VEHICLE_CONFIG` 說了算。
 */
const VEHICLE_CONFIG_KEY: Record<CivicVehicleKind, string> = {
  car: 'car',
  policeCar: 'police_car',
  ambulance: 'ambulance',
  firetruck: 'firetruck',
  bus: 'bus',
  garbageTruck: 'garbage_truck',
  van: 'van',
  truck: 'truck',
  airplane: 'airplane',
  ferry: 'ferry',
};

/**
 * `VEHICLE_CONFIG.color === −1` 的車種停著時用的定色。
 *
 * 那個 −1 的意思是「開在路上時逐台從色盤隨機挑」，而隨機需要一個 vehicle id
 * —— 停著的車沒有。公共建築又不做變體（三間警局必須長得一樣），所以這裡給
 * 定值。淺色是刻意的：這幾種在公共建築上的角色是**工作車輛**（機場的地勤車、
 * 廠區的貨車），而工作車輛就是淺色的。
 */
const PARKED_TINT: Partial<Record<CivicVehicleKind, number>> = {
  car: 0xb0bec5,
  van: 0xeceff1,
  truck: 0xcfd8dc,
  airplane: 0xf5f5f5,
};

/**
 * 停著的車該是什麼顏色。
 *
 * **停著的車與開在路上的同型車必須同色。** 這件事原本是壞的：車輛幾何把
 * 車身的頂點色寫成 (1, 1, 1)，真正的顏色是 `VehicleRenderer` 用
 * `setColorAt` 的逐實例色乘上去的 —— 而 `assembleVehicles` 產出的是普通
 * `Mesh`，沒有逐實例色。於是停在消防局門口的消防車是**白的**，而街上跑的
 * 是紅的。畫面上那台「不夠暗紅」的消防車其實根本沒有顏色。
 */
export function civicVehicleTint(kind: CivicVehicleKind): number {
  const cfg = VEHICLE_CONFIG[VEHICLE_CONFIG_KEY[kind]];
  if (cfg && cfg.color !== -1) return cfg.color;
  return PARKED_TINT[kind] ?? 0xbdbdbd;
}

/** 把顏色乘進頂點色 —— 與 `VehicleRenderer` 的逐實例色是同一個運算。 */
function tintVehicle(geo: THREE.BufferGeometry, hex: number): void {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3] = (arr[i * 3] ?? 1) * r;
    arr[i * 3 + 1] = (arr[i * 3 + 1] ?? 1) * g;
    arr[i * 3 + 2] = (arr[i * 3 + 2] ?? 1) * b;
  }
}

/**
 * 車種 → 幾何。
 *
 * 這張表是唯一的對應，寫死在別處的話就會出現「停著的救護車其實是廂型車」
 * 這種只有一個人看得出來的錯。
 */
/**
 * 飛機的垂直尾翼顏色。
 *
 * `VehicleRenderer` 給每一台飛機從 `AIRLINE_TAIL_COLORS` 挑一個尾翼色 ——
 * 那需要一個 vehicle id，而停著的飛機沒有。所以這裡給定值，理由與
 * `PARKED_TINT` 相同。深藍是最不會與淺色機身撞在一起的一個。
 */
export const PARKED_TAIL_TINT = 0x1e5aa8;

/**
 * 車種 → 幾何的**每一塊**，以及那一塊自己的顏色。
 *
 * 回傳陣列而不是單一幾何，是因為飛機不只一塊：`VehicleRenderer` 把機身與
 * **垂直尾翼**畫成兩個 instanced mesh，好讓尾翼有自己的塗裝色。只取機身的話
 * 停在停機坪上的飛機沒有尾翼 —— 而那是一眼就看得到的。
 *
 * `tint` 是這一塊自己的顏色；沒有的話吃整台車的顏色。
 */
const VEHICLE_PARTS: Record<
  CivicVehicleKind, () => Array<{ geo: THREE.BufferGeometry; tint?: number }>
> = {
  car: () => [{ geo: buildCarGeometry() }],
  policeCar: () => [{ geo: buildPoliceCarGeometry() }],
  ambulance: () => [{ geo: buildAmbulanceGeometry() }],
  firetruck: () => [{ geo: buildFiretruckGeometry() }],
  bus: () => [{ geo: buildBusGeometry() }],
  garbageTruck: () => [{ geo: buildGarbageTruckGeometry() }],
  van: () => [{ geo: buildVanGeometry() }],
  truck: () => [{ geo: buildTruckGeometry() }],
  airplane: () => [
    { geo: buildAirplaneGeometry() },
    { geo: buildAirplaneVTailGeometry(), tint: PARKED_TAIL_TINT },
  ],
  ferry: () => [{ geo: buildFerryGeometry() }],
};

/**
 * 一台車的每一塊，已經上好色、放在原點。
 *
 * 抽出來是為了讓展示區的**飛行中**飛機也走同一條路：它要的是一台上好色的
 * 飛機，但不要停放位置、也不要佔地護欄。各做一份的話，天上飛的與停著的
 * 塗裝會不一樣 —— 而那正是這一整批一直在避免的事。
 */
export function vehiclePieces(
  kind: CivicVehicleKind, tint?: number,
): THREE.BufferGeometry[] {
  return VEHICLE_PARTS[kind]().map(({ geo, tint: partTint }) => {
    // 車種之間的屬性集合本來就不一致：八種地面車帶 `uv`，飛機沒有。
    // 車輛材質（`MeshLambertMaterial` + 頂點色）不取樣任何貼圖，所以 uv 是
    // 純粹的死重 —— 一律丟掉，而不是替飛機補一份假的。
    geo.deleteAttribute('uv');
    tintVehicle(geo, partTint ?? tint ?? civicVehicleTint(kind));
    return geo;
  });
}

/** 一台上好色的完整車輛，合併成一份幾何、放在原點。 */
export function civicVehicleGeometry(
  kind: CivicVehicleKind, tint?: number,
): THREE.BufferGeometry {
  return mergeOrThrow(vehiclePieces(kind, tint), `車輛 ${kind}`);
}

/**
 * 停放的車輛轉幾何。
 *
 * **不 `tagPart`、不 `tagColor`。** 車輛的 `color` 屬性裝的是真正的 RGB，
 * 蓋掉的話車身的白藍會變成零件標籤。它們走的是車輛材質，不是建築 shader。
 *
 * 護欄與量體同一條，範圍量的是**旋轉之後**的包圍盒 —— 車轉了 90 度之後
 * 佔的方向就換了，用原本的長寬檢查會放行一台其實伸出去的車。
 *
 * 註：`computeBoundingBox()` 寫在旋轉之前或之後其實都對 —— three.js 的
 * `applyMatrix4` 在 `boundingBox` 已存在時會自己重算。這一行的位置不承重，
 * 承重的是「拿來檢查的是旋轉後的那個 box」。
 */
export function assembleVehicles(
  vehicles: readonly CivicVehicle[], footprint: Footprint,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bounds: Volume[] = [];

  for (const v of vehicles) {
    const box = new THREE.Box3();
    for (const geo of vehiclePieces(v.kind, v.tint)) {
      if (v.rotationY) geo.rotateY(v.rotationY);
      geo.translate(v.x, 0, v.z);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      parts.push(geo);
    }
    bounds.push({
      x: (box.min.x + box.max.x) / 2,
      z: (box.min.z + box.max.z) / 2,
      w: box.max.x - box.min.x,
      d: box.max.z - box.min.z,
      y0: 0,
      y1: 0,
    });
  }

  assertInside(bounds, footprint, CIVIC_INSET);

  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    // 材質吃頂點色，所以空幾何也要有 color —— 少了它 mergeGeometries 之後
    // 的屬性集合會與有車的情況不一致。
    empty.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    return empty;
  }
  return mergeOrThrow(parts, '車輛');
}

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  assembleVehicles, mergeOrThrow, civicVehicleTint, PARKED_TAIL_TINT,
} from '../assemble';
import { VEHICLE_CONFIG } from '../../../vehicleConfig';
import { buildPoliceCarGeometry } from '../../policeCar';
import { buildAirplaneGeometry, buildAirplaneVTailGeometry } from '../../index';
import { triangleCount } from '../../buildings/parts';
import type { CivicVehicle, Footprint } from '../types';

const FOOT: Footprint = { w: 2, h: 2 };

const car = (o: Partial<CivicVehicle> = {}): CivicVehicle =>
  ({ kind: 'policeCar', x: 0, z: 0, ...o });

/**
 * 停在基地上的車輛。
 *
 * 巡邏車原本只是一個方塊，而現成的幾何一直都在：`geometry/policeCar.ts`
 * 就是城市裡開著的那台警車。
 * 停在警局停車場的那一台當然該是同一台。
 *
 * 車輛**不能**併進建築的 mesh：它們用 `MeshLambertMaterial({vertexColors})`，
 * 把 RGB 直接寫在 `color` 屬性上；而建築 shader 把 `color` 讀成
 * （零件標籤, 分區, 地面明度）。混在一起的話，一台白藍相間的警車會被當成
 * `partType = 0.102` —— 落進金屬細節的分支，變成一塊灰。
 */
describe('停放的車輛', () => {
  it('should use the very geometry the driving cars use', () => {
    // 自己再畫一台的話，停著的警車與開著的警車長得不一樣。
    const parked = assembleVehicles([car()], FOOT);
    expect(triangleCount(parked)).toBe(triangleCount(buildPoliceCarGeometry()));
  });

  it('should keep the vehicle colours in the color attribute', () => {
    // 被 tagPart 蓋掉的話，車身的白藍會變成零件標籤。
    const geo = assembleVehicles([car()], FOOT);
    const c = geo.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i++) {
      seen.add([c.getX(i), c.getY(i), c.getZ(i)].map(v => v.toFixed(3)).join(','));
    }
    expect(seen.size, '整台車只剩一個顏色 —— 頂點色被蓋掉了').toBeGreaterThan(3);
  });

  it('should not carry the building attributes', () => {
    // 它走的是別的材質，那些屬性對它沒有意義；帶著只是白吃記憶體，
    // 而且 mergeGeometries 會因為屬性集合不一致而失敗。
    const geo = assembleVehicles([car()], FOOT);
    expect(geo.getAttribute('aBldgColor')).toBeUndefined();
  });

  it('should put the car where it was parked', () => {
    const at0 = assembleVehicles([car()], FOOT);
    const at1 = assembleVehicles([car({ x: 0.3, z: -0.2 })], FOOT);
    at0.computeBoundingBox();
    at1.computeBoundingBox();
    expect(at1.boundingBox!.min.x - at0.boundingBox!.min.x).toBeCloseTo(0.3, 6);
    expect(at1.boundingBox!.min.z - at0.boundingBox!.min.z).toBeCloseTo(-0.2, 6);
  });

  it('should turn the car to face the way it was parked', () => {
    // 幾何原本車頭朝 +x。停車格沿 z 排的話車要轉 90 度，否則它是橫著停的。
    const along = assembleVehicles([car()], FOOT);
    const across = assembleVehicles([car({ rotationY: Math.PI / 2 })], FOOT);
    along.computeBoundingBox();
    across.computeBoundingBox();
    const size = (g: THREE.BufferGeometry) => g.boundingBox!.getSize(new THREE.Vector3());
    expect(size(along).x, '沒轉的時候車身該沿 x 長').toBeGreaterThan(size(along).z);
    expect(size(across).z, '轉了 90 度之後該沿 z 長').toBeGreaterThan(size(across).x);
  });

  it('should keep vehicles inside the footprint', () => {
    expect(() => assembleVehicles([car({ x: 0.95 })], FOOT)).toThrow(/超出佔地/);
  });

  /**
   * 護欄要量**旋轉之後**的包圍盒。
   *
   * 警車是 0.22 長 × 0.09 寬。轉 90 度之後長的那一邊換到 z —— 用旋轉前的
   * 長寬檢查的話，一台其實伸出去 0.06 格（0.7 m）的車會被放行，而畫面上
   * 它只是「有點壓到隔壁」。
   *
   * 兩個方向都要測：只測「該擋的有擋」的話，把護欄寫成永遠 throw 也會通過。
   */
  it('should measure the bounding box after the car is turned', () => {
    // 轉了之後車身沿 z 長 —— 停在 z = 0.92 會伸出去。
    expect(() => assembleVehicles([car({ z: 0.92, rotationY: Math.PI / 2 })], FOOT),
      '轉向之後的越界沒有被擋下來').toThrow(/超出佔地/);
    // 同一個位置、同一台車，沒轉的話只佔 0.045 格寬，放得下。
    expect(() => assembleVehicles([car({ z: 0.92 })], FOOT),
      '沒轉的車被誤判成越界').not.toThrow();
  });

  it('should return an empty geometry when nothing is parked', () => {
    const geo = assembleVehicles([], FOOT);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color'), '空幾何也要有 color —— 材質吃頂點色').toBeTruthy();
  });

  /**
   * 不同車種的幾何**屬性集合不一樣**。
   *
   * 飛機是 `position,normal,color`，八種地面車是 `position,normal,color,uv`。
   * `mergeGeometries` 遇到不一致時**只印一行 console.error 然後回傳 null**
   * —— 不丟例外。所以 `mergeGeometries(parts)!` 那個 `!` 是在對 TypeScript
   * 說謊，而 null 會一路傳到瀏覽器裡的 `new THREE.Mesh` 才炸。
   *
   * 這正是它逃過所有測試的方式：資料表的「不得丟例外」是綠的（它真的沒丟），
   * 只有真的開起來才看得到。機場是第一個把飛機與公車停在同一塊地上的建築。
   */
  it('should merge vehicles whose geometries carry different attributes', () => {
    const geo = assembleVehicles([
      { kind: 'airplane', x: 0, z: -0.3 },
      { kind: 'bus', x: 0, z: 0.5 },
    ], { w: 4, h: 4 });
    expect(geo, 'mergeGeometries 回傳了 null').toBeTruthy();
    expect(geo.getAttribute('position').count, '合併之後是空的').toBeGreaterThan(0);
    expect(geo.getAttribute('color'), '合併之後掉了頂點色').toBeTruthy();
  });

  /**
   * 停著的車與開在路上的同型車必須**同色**。
   *
   * 這件事原本是壞的，而且完全沒有徵兆：車輛幾何把車身的頂點色寫成 (1, 1, 1)，
   * 真正的顏色是 `VehicleRenderer` 用 `setColorAt` 的逐實例色乘上去的 ——
   * 而 `assembleVehicles` 產出的是普通 `Mesh`，沒有逐實例色。於是停在消防局
   * 門口的消防車是**白的**。
   *
   * 看起來像「消防車不夠暗紅」，而真相是它根本沒有顏色。
   */
  it('should paint a parked vehicle the colour that type drives in', () => {
    const named: Array<[CivicVehicle['kind'], string]> = [
      ['policeCar', 'police_car'], ['ambulance', 'ambulance'],
      ['firetruck', 'firetruck'], ['bus', 'bus'], ['garbageTruck', 'garbage_truck'],
    ];
    for (const [kind, key] of named) {
      expect(civicVehicleTint(kind), `${kind} 停著與開著不同色`)
        .toBe(VEHICLE_CONFIG[key]!.color);
    }
  });

  it('should give a colour even to the types that drive in random ones', () => {
    // `VEHICLE_CONFIG.color === −1` 是「逐台從色盤隨機挑」，而隨機需要一個
    // vehicle id —— 停著的車沒有。公共建築又不做變體，所以要有定值。
    for (const kind of ['car', 'van', 'truck', 'airplane'] as const) {
      expect(civicVehicleTint(kind), `${kind} 沒有定色`).toBeGreaterThan(0);
    }
  });

  it('should actually put the colour on the geometry', () => {
    // 消防車車身的頂點色是 (1, 1, 1)。沒有乘上去的話它是白的。
    const geo = assembleVehicles([car({ kind: 'firetruck' })], { w: 2, h: 2 });
    const c = geo.getAttribute('color');
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < c.count; i++) { r += c.getX(i); g += c.getY(i); b += c.getZ(i); }
    expect(r / Math.max(g, 1e-6), '消防車不是紅的').toBeGreaterThan(1.6);
    expect(r / Math.max(b, 1e-6), '消防車不是紅的').toBeGreaterThan(1.6);
  });

  it('should let a plan override the tint', () => {
    // 機場的地勤貨車是淺色的，而街上跑的貨車是隨機色盤。
    const plain = assembleVehicles([car({ kind: 'truck' })], { w: 2, h: 2 });
    const white = assembleVehicles(
      [car({ kind: 'truck', tint: 0xffffff })], { w: 2, h: 2 });
    const sum = (g: THREE.BufferGeometry) => {
      const a = g.getAttribute('color');
      let t = 0;
      for (let i = 0; i < a.count; i++) t += a.getX(i) + a.getY(i) + a.getZ(i);
      return t;
    };
    expect(sum(white), '覆寫的顏色沒有生效').toBeGreaterThan(sum(plain));
  });

  /**
   * 飛機不只機身。
   *
   * `VehicleRenderer` 把它畫成兩個 instanced mesh：機身與**垂直尾翼** ——
   * 分開是為了讓尾翼有自己的塗裝色。只取 `buildAirplaneGeometry()` 的話停在
   * 停機坪上的飛機沒有尾翼，而那是一眼就看得到的。
   *
   * 與警車、消防車同一條原則：停著的與開著的必須是同一台。
   */
  it('should give the parked aeroplane its vertical tail', () => {
    const parked = assembleVehicles(
      [{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    expect(triangleCount(parked), '停著的飛機少了尾翼')
      .toBe(triangleCount(buildAirplaneGeometry())
        + triangleCount(buildAirplaneVTailGeometry()));
  });

  it('should paint the tail fin in its own colour', () => {
    // 尾翼與機身同色的話，那個「兩塊」就白分了 —— 而航空公司的塗裝就是
    // 靠尾翼認的。
    //
    // 比的是「尾翼那幾個顏色**確實出現在**成品裡」。「整台不只一個顏色」
    // 擋不住這件事：機身本來就有窗與機翼好幾種色，尾翼跟著機身上色也照樣
    // 通過（實測過）。
    const tail = buildAirplaneVTailGeometry();
    const tc = tail.getAttribute('color');
    const r = ((PARKED_TAIL_TINT >> 16) & 0xff) / 255;
    const g = ((PARKED_TAIL_TINT >> 8) & 0xff) / 255;
    const b = (PARKED_TAIL_TINT & 0xff) / 255;
    const want = new Set<string>();
    for (let i = 0; i < tc.count; i++) {
      want.add([tc.getX(i) * r, tc.getY(i) * g, tc.getZ(i) * b]
        .map(v => v.toFixed(3)).join(','));
    }

    const geo = assembleVehicles([{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    const c = geo.getAttribute('color');
    const got = new Set<string>();
    for (let i = 0; i < c.count; i++) {
      got.add([c.getX(i), c.getY(i), c.getZ(i)].map(v => v.toFixed(3)).join(','));
    }
    for (const w of want) {
      expect(got.has(w), `尾翼沒有塗上自己的顏色（缺 ${w}）`).toBe(true);
    }
  });

  it('should measure the aeroplane bounds across both pieces', () => {
    // 護欄只看機身的話，尾翼可以伸出佔地而沒有人擋。
    const tail = buildAirplaneVTailGeometry();
    tail.computeBoundingBox();
    const body = buildAirplaneGeometry();
    body.computeBoundingBox();
    const geo = assembleVehicles(
      [{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y, '尾翼沒有算進包圍盒')
      .toBeGreaterThanOrEqual(Math.max(tail.boundingBox!.max.y, body.boundingBox!.max.y) - 1e-9);
  });

  it('should support every vehicle the city already has', () => {
    // 消防局要消防車、醫院要救護車、垃圾場要垃圾車 —— 後面幾批都吃得到。
    const kinds: CivicVehicle['kind'][] = [
      'car', 'policeCar', 'ambulance', 'firetruck', 'bus', 'garbageTruck', 'van', 'truck',
    ];
    for (const kind of kinds) {
      expect(() => assembleVehicles([car({ kind })], FOOT), `${kind} 建不出來`)
        .not.toThrow();
    }
  });

  /**
   * 合併失敗要**大聲**失敗。
   *
   * `mergeGeometries` 的失敗是回傳 null，而 `!` 把它變成一個型別謊言。
   * 加一顆假的、屬性湊不起來的幾何進去，應該當場丟例外而不是回傳 null。
   */
  it('should throw, not return null, when geometries cannot be merged', () => {
    const bad = new THREE.BufferGeometry();
    bad.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    expect(() => mergeOrThrow([bad, buildPoliceCarGeometry()], '測試'))
      .toThrow(/合併失敗/);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleVehicles } from '../assemble';
import { buildPoliceCarGeometry } from '../../policeCar';
import { triangleCount } from '../../buildings/parts';
import type { CivicVehicle, Footprint } from '../types';

const FOOT: Footprint = { w: 2, h: 2 };

const car = (o: Partial<CivicVehicle> = {}): CivicVehicle =>
  ({ kind: 'policeCar', x: 0, z: 0, ...o });

/**
 * 停在基地上的車輛。
 *
 * 使用者：「巡邏車看起來是一個方塊而已，是不是有車輛的物件可以參考?」
 * 有 —— `geometry/policeCar.ts` 一直都在，而且城市裡開著的警車就是它。
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
});

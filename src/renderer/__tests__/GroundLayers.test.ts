import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GROUND_LAYERS } from '../geometry/buildings/propBands';
import { DECAL_Y, MARK_Y } from '../geometry/buildings/decals';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { INFRA_CONFIGS } from '../../core/building/InfraConfig';

interface Internals {
  zoneLayer: InstancedLayer;
  propLayer: InstancedLayer;
}

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

function baseY(layer: InstancedLayer, x: number, y: number): number {
  const entry = layer.entryFor(`${x},${y}`)!;
  const mesh = layer.meshFor(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(m).min.y;
}

/**
 * BUG-224：分區建築放在 y = 0.05，那是**路面**的高度（ROAD_Y 0.025 + 板厚
 * 0.05 的一半），不是地面的高度。地形表面是 y = 0，所以每一棟建築都浮空
 * 0.6 m，影子投在地上、建築從 0.6 m 才開始，太陽斜射時兩者分家。
 *
 * 基礎設施建築用的是 y = 0 —— 兩者不一致本身就是這是筆誤的證據。
 */
describe('GROUND_LAYERS', () => {
  it('should keep everything that sits on the ground within a few centimetres of it', () => {
    for (const [name, y] of Object.entries(GROUND_LAYERS)) {
      expect(y * METRES_PER_CELL, `${name} 離地 ${(y * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
      expect(y, `${name} 陷進地面`).toBeGreaterThan(0);
    }
  });

  it('should stack markings above paving', () => {
    // 標線疊在鋪面上，否則會 z-fighting。
    expect(GROUND_LAYERS.MARKING).toBeGreaterThan(GROUND_LAYERS.DECAL);
  });

  it('should be the only source of these heights', () => {
    expect(DECAL_Y).toBe(GROUND_LAYERS.DECAL);
    expect(MARK_Y).toBe(GROUND_LAYERS.MARKING);
  });
});

describe('buildings stand on the ground', () => {
  it('should put the bottom of every zone building within centimetres of the terrain', () => {
    const { renderer, internals } = fresh();
    const cases: Array<[number, number, 'LOW' | 'HIGH']> = [
      [ZoneType.RESIDENTIAL_LOW, 1, 'LOW'],
      [ZoneType.RESIDENTIAL_HIGH, 3, 'HIGH'],
      [ZoneType.COMMERCIAL_LOW, 2, 'LOW'],
      [ZoneType.INDUSTRIAL, 3, 'LOW'],
      [ZoneType.OFFICE, 3, 'HIGH'],
    ];
    cases.forEach(([zone, level, density], i) => {
      renderer.addBuilding(i, 0, zone, density, level, false);
      const y = baseY(internals.zoneLayer, i, 0);
      expect(y * METRES_PER_CELL, `zone ${zone} 浮空 ${(y * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
    });
  });

  it('should put ground props on the ground too', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_LOW, 'LOW', 3, false);
    const y = baseY(internals.propLayer, 0, 0);
    expect(y * METRES_PER_CELL, `地面物件浮空 ${(y * METRES_PER_CELL).toFixed(2)} m`)
      .toBeLessThan(0.1);
  });

  it('should stand every public facility on the ground too', () => {
    // 手寫的那一版有十七種的幾何底部寫在 0.05（路面高度），捷運站寫在
    // 0.01 —— 全部浮空，與分區建築同一個成因。
    //
    // 十九種**全部**要查，渡輪碼頭也是：它曾經是唯一伸進水裡的一種，而那一版
    // 在基地裡自己畫了港池。`isShorePosition` 的定義是「這一格是陸地，而且
    // 四鄰有一格是水」—— 碼頭蓋在陸地上，水在隔壁那一格。
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    let i = 0;
    for (const cfg of INFRA_CONFIGS) {
      renderer.addInfrastructure(scene, i * 12, 0, cfg.type, 0);
      i++;
    }
    for (const group of scene.children) {
      if (!(group instanceof THREE.Group)) continue;
      const minY = new THREE.Box3().setFromObject(group).min.y;
      expect(minY * METRES_PER_CELL, `設施浮空 ${(minY * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
      expect(minY * METRES_PER_CELL, `設施陷入 ${(-minY * METRES_PER_CELL).toFixed(2)} m`)
        .toBeGreaterThan(-0.1);
    }
  });

  it('should stand the ferry dock on the land it is actually built on', () => {
    // 這一條原本反過來寫：碼頭要伸到水面（−0.2）之下，而 `snapToGround` 為此
    // 開了一個例外。那是照著「基地裡有港池」那一版寫的，而那片水後來拿掉了
    // （BUG-244）—— `isShorePosition` 要求碼頭那一格**是陸地**。
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.addInfrastructure(scene, 0, 0, 'ferry_dock', 0);
    const group = scene.children.find(c => c instanceof THREE.Group)!;
    const minY = new THREE.Box3().setFromObject(group).min.y;
    expect(minY, '碼頭陷到地面以下 —— 這一格是陸地').toBeGreaterThanOrEqual(0);
    expect(minY * METRES_PER_CELL, '碼頭浮空').toBeLessThan(0.1);
  });

  it('should not leave a step between a building and its own forecourt', () => {
    // 前庭鋪面與牆腳對不上的話，浮空反而更明顯。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 3, false);
    const building = baseY(internals.zoneLayer, 0, 0);
    expect(Math.abs(building - GROUND_LAYERS.DECAL) * METRES_PER_CELL,
      '建築底面與鋪面高度差').toBeLessThan(0.05);
  });
});

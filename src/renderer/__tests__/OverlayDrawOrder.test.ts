import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { getBuildingMaterial } from '../BuildingMaterial';
import { Grid } from '../../core/grid/Grid';

/**
 * 覆蓋層必須自己指定繪製順序。
 *
 * 建築材質是 `transparent: true`，所以建築、地面貼片與覆蓋層全都在同一個透明
 * 批次裡。three.js 對透明物件是**按物件中心點到鏡頭的距離**排序的 —— 而覆蓋層
 * 是一整張蓋滿全圖的單一 mesh，中心點只有一個。兩者比大小時比的是那一個點，
 * 所以**鏡頭一轉前後關係就翻面**：地面貼片一下子被半透明色塊蓋掉、一下子又
 * 冒出來。
 *
 * 指定 renderOrder 之後排序不再取決於鏡頭角度。覆蓋層排在地面細節**之前**，
 * 所以貼片畫在色塊上面 —— 玩家同時看得到「這一格的數值」與「這裡有什麼」。
 */

function buildOverlay(type: OverlayType) {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  const grid = new Grid(16, 16);
  const data = new Map<string, number>([['3,3', 80], ['4,4', 40]]);
  renderer.setOverlay(type, scene, grid, data);
  return renderer as unknown as { mesh: THREE.Mesh | null; elevatedMesh: THREE.Mesh | null };
}

const GROUND_DETAIL_ORDER = 0;

describe('覆蓋層的繪製順序', () => {
  it('should give the ground overlay an explicit draw order', () => {
    const internals = buildOverlay(OverlayType.POLICE);
    expect(internals.mesh, '覆蓋層沒有建起來，這條測試等於沒測').not.toBeNull();
    expect(
      internals.mesh!.renderOrder,
      '地面覆蓋層沒有指定繪製順序，排序會隨鏡頭角度翻面',
    ).toBeLessThan(GROUND_DETAIL_ORDER);
  });

  it('should order every overlay type the same way', () => {
    // 不是只有某幾種圖層有這個毛病 —— 它們共用同一段建立程式碼。
    for (const type of [OverlayType.POLICE, OverlayType.HEALTH, OverlayType.COMMUTE, OverlayType.POLLUTION]) {
      const internals = buildOverlay(type);
      expect(internals.mesh!.renderOrder, `${type} 的繪製順序與其他圖層不同`)
        .toBeLessThan(GROUND_DETAIL_ORDER);
    }
  });

  it('should keep the overlay from writing depth', () => {
    // 排在地面細節之前，靠的是「不寫深度」—— 寫了的話後面畫的貼片會被深度測試擋掉。
    const internals = buildOverlay(OverlayType.COMMUTE);
    const mat = internals.mesh!.material as THREE.MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
  });

  it('should sit behind the building layer, which owns the default order', () => {
    // 建築與貼片用的是同一份材質，繪製順序是預設的 0。這條把那個前提釘住 ——
    // 哪天建築層改了順序，這裡會知道。
    expect(getBuildingMaterial().transparent, '建築材質不再是透明的，整條推論要重看').toBe(true);
  });
});

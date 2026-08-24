import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { getBuildingMaterial } from '../BuildingMaterial';
import { Grid } from '../../core/grid/Grid';

/**
 * An overlay sets its own render order.
 *
 * The building material is `transparent: true`, so buildings, ground decals and overlays all land in
 * one transparent batch, which three.js sorts **by the distance from each object's centre to the
 * camera**. An overlay is a single mesh covering the whole map and has exactly one centre, so the
 * comparison rests on that one point and **the depth relation flips as the camera turns**: ground
 * decals are covered by the translucent patch one moment and back on top the next.
 *
 * With a render order set, the sorting no longer depends on the camera angle. Overlays draw
 * **before** the ground detail, so decals land on top of the patches and the player sees both the
 * cell's value and what stands there.
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
    // Not confined to a few overlays: they share one piece of construction code.
    for (const type of [OverlayType.POLICE, OverlayType.HEALTH, OverlayType.COMMUTE, OverlayType.POLLUTION]) {
      const internals = buildOverlay(type);
      expect(internals.mesh!.renderOrder, `${type} 的繪製順序與其他圖層不同`)
        .toBeLessThan(GROUND_DETAIL_ORDER);
    }
  });

  it('should keep the overlay from writing depth', () => {
    // Drawing before the ground detail works only without depth writes; with them, the decals drawn
    // afterwards fail the depth test.
    const internals = buildOverlay(OverlayType.COMMUTE);
    const mat = internals.mesh!.material as THREE.MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
  });

  it('should sit behind the building layer, which owns the default order', () => {
    // Buildings and decals share one material at the default render order of 0. This pins that
    // premise, so a change to the building layer's order shows up here.
    expect(getBuildingMaterial().transparent, '建築材質不再是透明的，整條推論要重看').toBe(true);
  });
});

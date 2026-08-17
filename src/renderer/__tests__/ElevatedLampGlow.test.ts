import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { Grid } from '../../core/grid/Grid';
import { RoadType, RoadDirection } from '../../core/road/types';

/**
 * 高架路燈的光暈是半圓。
 *
 * 燈站在橋面邊緣，整圈的光暈有一半會灑到橋外的空中 —— 看起來像一片浮在半空的
 * 黃霧。地面的路燈不受影響，它四周都是地。
 */

function elevatedScene(): THREE.Scene {
  const grid = new Grid(8, 8);
  const em = new ElevationManager();
  for (let y = 2; y <= 5; y++) {
    em.set(4, y, 1, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
      railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0,
    });
  }
  const scene = new THREE.Scene();
  new ElevatedRoadRenderer().build(scene, grid, em);
  return scene;
}

/** 找出光暈那個 mesh —— 它是唯一帶頂點色漸層的圓盤。 */
function glowGeometry(scene: THREE.Scene): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    const g = o.geometry;
    if (g.getAttribute('color') && g.getAttribute('position').count < 40) found = g;
  });
  expect(found, '找不到光暈，這支測試等於沒測').not.toBeNull();
  return found!;
}

describe('高架路燈的光暈', () => {
  it('should only cover half the disc', () => {
    // 整圓的話所有頂點會繞著中心散開一圈;半圓的話全部落在同一側。
    const pos = glowGeometry(elevatedScene()).getAttribute('position');
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
    }
    // 半圓靠在 z=0 這條直邊上，只往一側長。
    expect(Math.min(Math.abs(minZ), Math.abs(maxZ))).toBeLessThan(1e-6);
    expect(Math.max(Math.abs(minZ), Math.abs(maxZ))).toBeGreaterThan(0.3);
  });

  it('should still fade out from the lamp', () => {
    // 頂點色是漸層，中心亮邊緣暗。半圓化不能把它弄丟。
    const geo = glowGeometry(elevatedScene());
    const color = geo.getAttribute('color');
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < color.count; i++) {
      min = Math.min(min, color.getX(i));
      max = Math.max(max, color.getX(i));
    }
    expect(max - min).toBeGreaterThan(0.5);
  });
});

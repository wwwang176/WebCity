import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { Grid } from '../../core/grid/Grid';
import { RoadType, RoadDirection } from '../../core/road/types';

/**
 * 高架的路緣沒有影子。
 *
 * 它是一張**零厚度**的平面（`PlaneGeometry` 轉平），法線朝上。而 three.js 畫陰影圖
 * 的時候，`FrontSide` 的材質預設是渲染**背面**（`shadowSideTable`）—— 從頭頂的太陽
 * 看過去，這張平面露出來的是正面，背面被剔除，於是深度圖裡什麼都沒有，影子自然
 * 也沒有。
 *
 * 高架路面是一塊 `BoxGeometry`，它的底面就是背面，所以它一直都有影子 —— 兩者並排，
 * 缺的那一條特別明顯。
 *
 * 這條測試不是去比對某一個欄位等於某個值，而是問一個會重複發生的問題:**任何說自己
 * 要投影、但沒有厚度的東西，都得指定 `shadowSide`**。
 */

function buildElevated(): THREE.Scene {
  const grid = new Grid(8, 8);
  const em = new ElevationManager();
  const seg = {
    roadType: RoadType.TWO_LANE,
    roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
    railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0,
  };
  for (let y = 2; y <= 5; y++) em.set(4, y, 1, seg);

  const scene = new THREE.Scene();
  new ElevatedRoadRenderer().build(scene, grid, em);
  return scene;
}

/** 這個幾何有沒有厚度 —— 三個軸都要張得開才算立體。 */
function isFlat(geo: THREE.BufferGeometry): boolean {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const eps = 1e-6;
  return (b.max.x - b.min.x) < eps || (b.max.y - b.min.y) < eps || (b.max.z - b.min.z) < eps;
}

describe('高架的影子', () => {
  it('should give every flat caster a shadowSide', () => {
    const casters: THREE.Mesh[] = [];
    buildElevated().traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow) casters.push(o);
    });
    expect(casters.length, '沒有任何東西說要投影，這支測試等於沒測').toBeGreaterThan(0);

    for (const m of casters) {
      if (!isFlat(m.geometry)) continue;
      const mat = m.material as THREE.Material;
      expect(mat.shadowSide, `${m.type} 是零厚度的面，說要投影卻沒有指定 shadowSide`)
        .not.toBeNull();
    }
  });

  it('should actually have a flat caster to worry about', () => {
    // 如果哪天路緣改成有厚度的盒子，上面那條會空轉 —— 這條會先倒，提醒去看一眼。
    const flats = [] as THREE.Mesh[];
    buildElevated().traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow && isFlat(o.geometry)) flats.push(o);
    });
    expect(flats.length).toBeGreaterThan(0);
  });
});

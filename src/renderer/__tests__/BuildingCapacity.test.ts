import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { getVariants } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * 桶數從 17 成長到 60（2C 之後 168），固定預配 6000 會讓常駐記憶體
 * 從 6.5 MB 漲到 60 MB 以上。改成倍增之後，重配那一刻要搬矩陣、顏色與
 * 四個自訂屬性 —— 漏搬任何一個，建築就會戴上別人的資料，而且只在城市
 * 長到超過初始容量時才發生。
 */
const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

function freshRenderer(scene = new THREE.Scene()) {
  const renderer = new BuildingRenderer();
  renderer.build(scene, new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals, scene };
}

/** 填滿一片一定會撐破初始容量的建築。回傳所有座標。 */
function fillPast(renderer: BuildingRenderer, w = 40, h = 30): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
      cells.push([x, y]);
    }
  }
  return cells;
}

describe('bucket capacity', () => {
  it('should start small rather than pre-allocating for a full map', () => {
    const { internals } = freshRenderer();
    for (const [key, mesh] of internals.variantMeshes) {
      expect(mesh.instanceMatrix.count, `${key} pre-allocated too much`)
        .toBeLessThanOrEqual(256);
    }
  });

  it('should keep accepting buildings past the initial capacity', () => {
    const { renderer, internals } = freshRenderer();
    const cells = fillPast(renderer);
    expect(internals.positionToInstance.size).toBe(cells.length);
  });

  it('should carry every instance intact across a regrow', () => {
    const { renderer, internals } = freshRenderer();
    const cells = fillPast(renderer);

    const m = new THREE.Matrix4();
    const variants = getVariants(ZONE, 1);
    for (const [x, y] of cells) {
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      const mesh = internals.variantMeshes.get(entry.key)!;

      mesh.getMatrixAt(entry.idx, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x, `matrix lost for ${x},${y}`).toBeCloseTo(x, 5);
      expect(p.z).toBeCloseTo(y, 5);

      const expected = appearanceOf({
        x, y, zoneType: ZONE, level: 1, seedByte: 0,
        variantCount: variants.length, paletteSize: 1,
      }).facadeSeed;
      const seed = mesh.geometry.getAttribute('aSeed');
      expect(seed.getX(entry.idx), `aSeed lost for ${x},${y}`).toBeCloseTo(expected[0], 6);
      expect(seed.getY(entry.idx)).toBeCloseTo(expected[1], 6);
      expect(seed.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
    }
  });

  it('should keep the mesh in the scene after a regrow', () => {
    // 重配會建立新的 InstancedMesh；忘記把舊的移出場景、新的加進去，
    // 城市會在長到某個大小時整片消失或畫兩次。
    const { renderer, internals, scene } = freshRenderer();
    // 重配前的那一批 mesh。場景裡的 InstancedMesh 不只變體桶（還有 zone
    // overlay 與燈光點），所以數總數會抓錯人 —— 直接盯被換掉的那些。
    const before = new Map(internals.variantMeshes);
    fillPast(renderer);

    let regrown = 0;
    for (const [key, oldMesh] of before) {
      const now = internals.variantMeshes.get(key)!;
      if (now === oldMesh) continue;
      regrown++;
      expect(scene.children.includes(now), `${key} grew but is not in the scene`).toBe(true);
      expect(scene.children.includes(oldMesh), `${key} left its old mesh in the scene`).toBe(false);
    }
    expect(regrown, 'nothing regrew, so this case proves nothing').toBeGreaterThan(0);
  });
});

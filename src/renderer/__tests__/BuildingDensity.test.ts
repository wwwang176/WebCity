import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { bucketKey } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * BUG-220：辦公區有兩種密度，人口差 11 倍（15 對 160），而渲染層拿不到
 * 密度，所以兩者外觀完全一樣。
 */
interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

function freshRenderer() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

describe('density reaches the renderer', () => {
  it('should put low and high density offices in different buckets', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.OFFICE, 'LOW', 1, false);
    renderer.addBuilding(2, 1, ZoneType.OFFICE, 'HIGH', 1, false);

    // 比對 key 裡的密度段，不是整個 key：兩個不同格子的 variantIndex 本來
    // 就可能不同，整串比對會在密度根本沒進 key 時照樣通過。
    const densityOf = (posKey: string) =>
      internals.positionToInstance.get(posKey)!.key.split('_')[1];
    expect(densityOf('1,1')).toBe('LOW');
    expect(densityOf('2,1')).toBe('HIGH');
  });

  it('should render a high-density office taller than a low-density one', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.OFFICE, 'LOW', 1, false);
    renderer.addBuilding(2, 1, ZoneType.OFFICE, 'HIGH', 1, false);

    // 量幾何本身的高度，不是矩陣的縮放 —— 生成器產出的就是最終尺寸，
    // 矩陣只剩旋轉與位移（階段 2C-1）。
    const heightAt = (posKey: string) => {
      const e = internals.positionToInstance.get(posKey)!;
      const geo = internals.variantMeshes.get(e.key)!.geometry;
      geo.computeBoundingBox();
      return geo.boundingBox!.max.y;
    };
    expect(heightAt('2,1')).toBeGreaterThan(heightAt('1,1'));
  });

  it('should separate every level into its own bucket', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.RESIDENTIAL_LOW, 'LOW', 1, false);
    renderer.addBuilding(1, 2, ZoneType.RESIDENTIAL_LOW, 'LOW', 3, false);
    expect(internals.positionToInstance.get('1,1')!.key)
      .not.toBe(internals.positionToInstance.get('1,2')!.key);
  });
});

describe('bucketKey', () => {
  it('should distinguish every dimension it carries', () => {
    const base = bucketKey(ZoneType.OFFICE, 'LOW', 1, 0);
    expect(bucketKey(ZoneType.OFFICE, 'HIGH', 1, 0)).not.toBe(base);
    expect(bucketKey(ZoneType.OFFICE, 'LOW', 2, 0)).not.toBe(base);
    expect(bucketKey(ZoneType.OFFICE, 'LOW', 1, 1)).not.toBe(base);
    expect(bucketKey(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 0)).not.toBe(base);
  });
});

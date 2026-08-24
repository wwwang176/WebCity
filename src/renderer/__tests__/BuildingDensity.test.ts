import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { bucketKey } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * BUG-220: offices come in two densities whose populations differ elevenfold, 15 against 160, while
 * the renderer cannot see the density and draws both identically.
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

    // Compares the density field of the key rather than the whole key: two cells may legitimately
    // differ in variantIndex, and comparing the whole string passes even when the density never
    // entered the key at all.
    const densityOf = (posKey: string) =>
      internals.positionToInstance.get(posKey)!.key.split('_')[1];
    expect(densityOf('1,1')).toBe('LOW');
    expect(densityOf('2,1')).toBe('HIGH');
  });

  it('should render a high-density office taller than a low-density one', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.OFFICE, 'LOW', 1, false);
    renderer.addBuilding(2, 1, ZoneType.OFFICE, 'HIGH', 1, false);

    // Measures the geometry's own height rather than the matrix scale: the generator emits final
    // dimensions and the matrix carries only rotation and translation.
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

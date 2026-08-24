import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { getMassingVariants } from '../geometry/buildings/massing';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * With 168 buckets, a fixed preallocation of 6000 instances holds over 60 MB resident. Growing by
 * doubling instead, the moment of reallocation has to carry over the matrices, the colours and the
 * four custom attributes — miss any one and buildings wear another building's data, and only once
 * the city grows past the initial capacity.
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

/**
 * Fills an area with enough buildings to certainly exceed the initial capacity, and returns every
 * coordinate.
 *
 * The size has to beat `initial capacity x variant count`: with eight variants, 40x30 = 1200
 * buildings split across eight buckets is only 150 each, none exceeds 256, and the whole doubling
 * suite silently verifies nothing.
 */
function fillPast(renderer: BuildingRenderer, w = 64, h = 40): Array<[number, number]> {
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
    const variants = getMassingVariants(ZONE, 'LOW', 1);
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
      // aSeed.x comes from the variant rather than per-cell randomness, so this only checks the two
      // per-cell components, phase and material, for loss during the doubling.
      expect(seed.getY(entry.idx)).toBeCloseTo(expected[1], 6);
      expect(seed.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
    }
  });

  it('should keep the mesh in the scene after a regrow', () => {
    // Reallocating creates a new InstancedMesh; forget to remove the old one from the scene or to
    // add the new one and the city vanishes, or draws twice, once it reaches a certain size.
    const { renderer, internals, scene } = freshRenderer();
    // The meshes from before the reallocation. The scene's InstancedMeshes are not only the variant
    // buckets — the zone overlay and the lights are there too — so a total count catches the wrong
    // objects; these watch the ones actually replaced.
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

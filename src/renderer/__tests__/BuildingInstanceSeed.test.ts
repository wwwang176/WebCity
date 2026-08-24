import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { bucketKey } from '../geometry/buildings/registry';
import { floorHeightOf } from '../geometry/buildings/massing';
import { FLOOR_HEIGHT_UNITS } from '../geometry/buildings/massing/metrics';
import { getMassingVariants } from '../geometry/buildings/massing';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * An InstancedMesh removes by swap-with-last, so every removal moves somebody else's index. The
 * bucket count grows from 17 to 144, multiplying the chances of a mis-moved index, and on screen it
 * shows only as "that building suddenly looks like something else", which is hard to track down.
 * This pins the invariants.
 */
const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

/** A real, empty Grid: safer than a fake and needing no `as never`. */
function freshRenderer(): { renderer: BuildingRenderer; internals: Internals } {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

function expectedAppearance(x: number, y: number) {
  const variants = getMassingVariants(ZONE, 'LOW', 1);
  return appearanceOf({
    x, y, zoneType: ZONE, level: 1, seedByte: 0,
    variantCount: variants.length, paletteSize: 1,
  });
}

describe('instance bookkeeping', () => {
  it('should put every building in the bucket appearanceOf names', () => {
    // It sweeps an area rather than sampling one cell: low-density residential has three variants, so
    // any one cell has a one-in-three chance of the old and new hashes picking the same one, and a
    // single-cell assertion passes by coincidence.
    const { renderer, internals } = freshRenderer();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    }

    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const entry = internals.positionToInstance.get(`${x},${y}`);
        expect(entry, `no instance for ${x},${y}`).toBeDefined();
        expect(entry!.key, `wrong bucket at ${x},${y}`)
          .toBe(bucketKey(ZONE, 'LOW', 1, expectedAppearance(x, y).variantIndex));
      }
    }
  });

  it('should keep every surviving building pointing at its own matrix', () => {
    const { renderer, internals } = freshRenderer();

    const alive: Array<[number, number]> = [];
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
        alive.push([x, y]);
      }
    }
    // Remove a third, forcing swap-with-last.
    for (let i = alive.length - 1; i >= 0; i -= 3) {
      const [x, y] = alive[i]!;
      renderer.removeBuilding(x, y);
      alive.splice(i, 1);
    }

    const m = new THREE.Matrix4();
    for (const [x, y] of alive) {
      const entry = internals.positionToInstance.get(`${x},${y}`);
      expect(entry, `no instance for ${x},${y}`).toBeDefined();
      internals.variantMeshes.get(entry!.key)!.getMatrixAt(entry!.idx, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x, `instance for ${x},${y} sits at ${p.x},${p.z}`).toBeCloseTo(x, 5);
      expect(p.z).toBeCloseTo(y, 5);
    }
  });
});

describe('aSeed', () => {
  it('should exist on every variant mesh with three components per instance', () => {
    const { internals } = freshRenderer();
    expect(internals.variantMeshes.size).toBeGreaterThan(0);
    for (const [key, mesh] of internals.variantMeshes) {
      const attr = mesh.geometry.getAttribute('aSeed');
      expect(attr, `${key} has no aSeed`).toBeDefined();
      expect(attr.itemSize, `${key} aSeed itemSize`).toBe(3);
    }
  });

  it('should carry the facade seed appearanceOf gives that cell', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(6, 2, ZONE, 'LOW', 1, false);

    const entry = internals.positionToInstance.get('6,2')!;
    const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');
    const expected = expectedAppearance(6, 2).facadeSeed;

    // aSeed.x is not facadeSeed[0]: the floor rhythm comes from the variant so the window rows align
    // with the real floor lines. Phase and material preference stay per cell.
    expect(attr.getY(entry.idx)).toBeCloseTo(expected[1], 6);
    expect(attr.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
  });

  it('should follow the building when swap-with-last moves it', () => {
    // aOccupancy already has move logic; with aSeed left behind, the moved building wears another
    // building's facade — and only after the player demolishes something.
    const { renderer, internals } = freshRenderer();

    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push([x, y]);
    for (const [x, y] of cells) renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    for (let i = 0; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      renderer.removeBuilding(x, y);
    }

    for (let i = 1; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');
      const expected = expectedAppearance(x, y).facadeSeed;
      // aSeed.x is not facadeSeed[0]: the floor rhythm comes from the variant so the window rows
      // align with the real floor lines. Phase and material preference stay per cell.
      expect(attr.getY(entry.idx), `aSeed.y wrong at ${x},${y}`).toBeCloseTo(expected[1], 6);
      expect(attr.getZ(entry.idx), `aSeed.z wrong at ${x},${y}`).toBeCloseTo(expected[2], 6);
    }
  });

  it('should hand the shader the floor height its variant was built with', () => {
    // As a per-cell hash, aSeed.x leaves the window rows and the floors drawn independently and the
    // top row of windows cut in half by the roof, with nothing reporting it.
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.build(scene, new Grid(1, 1));
    renderer.addBuilding(0, 0, ZoneType.OFFICE, 'HIGH', 3, false);

    const internals = renderer as unknown as {
      positionToInstance: Map<string, { key: string; idx: number }>;
      variantMeshes: Map<string, THREE.InstancedMesh>;
    };
    const entry = internals.positionToInstance.get('0,0')!;
    const mesh = internals.variantMeshes.get(entry.key)!;
    const seed = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
    const rhythm = (seed.array as Float32Array)[entry.idx * 3]!;

    // The shader's floorHeight = mix(MIN, MAX, aSeed.x).
    const shaderFloor = FLOOR_HEIGHT_UNITS.MIN
      + (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN) * rhythm;
    const vi = Number(entry.key.split('_')[3]);
    expect(shaderFloor).toBeCloseTo(floorHeightOf(ZoneType.OFFICE, 'HIGH', 3, vi), 6);
  });
});
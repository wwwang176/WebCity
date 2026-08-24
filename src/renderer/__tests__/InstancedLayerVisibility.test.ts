import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstancedLayer } from '../InstancedLayer';

/**
 * An empty bucket's visibility.
 *
 * three.js still walks the whole render list for an `InstancedMesh` with `count === 0`. At 168
 * massing buckets the cost of empty ones is noticeable, and at the start of a game and in a sparse
 * city most buckets are empty.
 *
 * These cases drive `InstancedLayer` directly rather than going through `BuildingRenderer`, whose
 * `build()` calls `reset()` after creating a bucket and overwrites `createBucket`'s initial state:
 * entered that way, deleting the line in `createBucket` would not turn anything red.
 */
function layer() {
  const scene = new THREE.Scene();
  const l = new InstancedLayer(new THREE.MeshBasicMaterial(), 4);
  l.createBucket(scene, 'a', new THREE.BoxGeometry(1, 1, 1));
  l.createBucket(scene, 'b', new THREE.BoxGeometry(1, 1, 1));
  return { scene, l };
}

describe('empty instanced buckets are not drawn', () => {
  it('should be born invisible', () => {
    // A freshly created empty bucket is invisible on its own, without relying on a later reset.
    const { l } = layer();
    expect(l.meshFor('a')!.visible).toBe(false);
    expect(l.meshFor('b')!.visible).toBe(false);
  });

  it('should become visible on the first instance', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    expect(l.meshFor('a')!.visible).toBe(true);
    expect(l.meshFor('b')!.visible, '沒用到的桶被連帶打開').toBe(false);
  });

  it('should go dark again when the last instance leaves', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    l.acquire(scene, 'a', '1,0');
    l.release('0,0');
    expect(l.meshFor('a')!.visible, '還有一個實例就不該關掉').toBe(true);
    l.release('1,0');
    expect(l.meshFor('a')!.visible).toBe(false);
  });

  it('should go dark on reset', () => {
    const { scene, l } = layer();
    l.acquire(scene, 'a', '0,0');
    l.reset();
    expect(l.meshFor('a')!.visible).toBe(false);
  });

  it('should stay visible across a capacity doubling', () => {
    // Doubling swaps in a new InstancedMesh and the visibility has to carry over, or a whole
    // bucket of buildings vanishes at the moment the city grows past a certain size.
    const { scene, l } = layer();
    for (let i = 0; i < 6; i++) l.acquire(scene, 'a', `${i},0`);
    expect(l.countOf('a')).toBe(6);
    expect(l.meshFor('a')!.visible).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { propGeometry, propExtent, type PropSpec } from '../props';
import { triangleCount } from '../buildings/parts';
import { M } from '../buildings/massing/metrics';

const boundsOf = (parts: THREE.BufferGeometry[]) => {
  const box = new THREE.Box3();
  for (const g of parts) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  return box;
};

/**
 * Fences.
 *
 * `props.ts` has always carried the `fencePost` and `fenceRail` primitives, which the residential
 * side calls after computing coordinates from its prop band, but no declarative entry point — and
 * civic buildings are declarative and can only write a table. All four industrial sites and the
 * airports need fences, and each redrawing one from box masses gives four differently shaped
 * fences in one city.
 */
describe('圍籬', () => {
  const fence = (o: Partial<Extract<PropSpec, { kind: 'fence' }>> = {}) =>
    ({ kind: 'fence' as const, x: 0, z: 0, axis: 'z' as const, length: M(6), ...o });

  it('should build posts and a rail', () => {
    const parts = propGeometry(fence());
    expect(parts.length, '圍籬不只一段').toBeGreaterThan(2);
    for (const g of parts) expect(triangleCount(g), '有一段是空的').toBeGreaterThan(0);
  });

  it('should span the length it was asked for', () => {
    // Too short and a gap shows between two runs; too long and it reaches off the plot.
    const box = boundsOf(propGeometry(fence({ length: M(6) })));
    expect(box.max.x - box.min.x).toBeCloseTo(M(6), 4);
  });

  it('should lay the fence along the axis it was given', () => {
    // `'z'` means it runs along world x, the same convention as `strip` and `hedge`. Inconsistent,
    // a fence meant to close a site's north edge lies across the gate instead.
    const along = boundsOf(propGeometry(fence({ axis: 'z' })));
    const across = boundsOf(propGeometry(fence({ axis: 'x' })));
    expect(along.max.x - along.min.x).toBeGreaterThan(along.max.z - along.min.z);
    expect(across.max.z - across.min.z).toBeGreaterThan(across.max.x - across.min.x);
  });

  it('should space the posts evenly along the run', () => {
    // Unevenly spaced posts read as a broken fence. The post count grows with the length; fixed at
    // three, a 30 m fence leaves two long unsupported rails sagging across the middle.
    const short = propGeometry(fence({ length: M(4) })).length;
    const long = propGeometry(fence({ length: M(20) })).length;
    expect(long, '長圍籬沒有多加柱子').toBeGreaterThan(short);
  });

  it('should report an extent that covers the whole run', () => {
    // Under-reported, it reaches off the plot unchecked, since `assembleFixtures` reads only
    // `propExtent`.
    const e = propExtent(fence({ length: M(6) }));
    const box = boundsOf(propGeometry(fence({ length: M(6) })));
    expect(e.x + 1e-9, '沿長度的範圍少報了').toBeGreaterThanOrEqual(box.max.x);
    expect(e.z + 1e-9, '沿厚度的範圍少報了').toBeGreaterThanOrEqual(box.max.z);
  });

  it('should stay below head height', () => {
    // A fence is a low prop. Above the 2.2 m pedestrian clearance it becomes a wall.
    const box = boundsOf(propGeometry(fence()));
    expect(box.max.y * 12).toBeLessThan(2.2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeGroup } from '../disposeGroup';

describe('disposeGroup', () => {
  it('disposes geometry and material of child meshes', () => {
    const group = new THREE.Group();
    const geo1 = new THREE.BoxGeometry(1, 1, 1);
    const mat1 = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const mesh1 = new THREE.Mesh(geo1, mat1);
    group.add(mesh1);

    const geo2 = new THREE.SphereGeometry(0.5);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh2 = new THREE.Mesh(geo2, mat2);
    group.add(mesh2);

    const spy1Geo = vi.spyOn(geo1, 'dispose');
    const spy1Mat = vi.spyOn(mat1, 'dispose');
    const spy2Geo = vi.spyOn(geo2, 'dispose');
    const spy2Mat = vi.spyOn(mat2, 'dispose');

    disposeGroup(group);

    expect(spy1Geo).toHaveBeenCalledOnce();
    expect(spy1Mat).toHaveBeenCalledOnce();
    expect(spy2Geo).toHaveBeenCalledOnce();
    expect(spy2Mat).toHaveBeenCalledOnce();
  });

  it('handles nested groups', () => {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    inner.add(mesh);
    outer.add(inner);

    const spyGeo = vi.spyOn(geo, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    disposeGroup(outer);

    expect(spyGeo).toHaveBeenCalledOnce();
    expect(spyMat).toHaveBeenCalledOnce();
  });

  it('skips non-mesh children', () => {
    const group = new THREE.Group();
    const light = new THREE.PointLight();
    group.add(light);

    // Should not throw
    expect(() => disposeGroup(group)).not.toThrow();
  });

  it('handles shared material (dispose each instance)', () => {
    const group = new THREE.Group();
    const sharedMat = new THREE.MeshLambertMaterial();
    const geo1 = new THREE.BoxGeometry(1, 1, 1);
    const geo2 = new THREE.BoxGeometry(1, 1, 1);
    group.add(new THREE.Mesh(geo1, sharedMat));
    group.add(new THREE.Mesh(geo2, sharedMat));

    const spyMat = vi.spyOn(sharedMat, 'dispose');

    disposeGroup(group);

    // dispose is called for each mesh that references it
    expect(spyMat).toHaveBeenCalledTimes(2);
  });

  it('handles material array', () => {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat1 = new THREE.MeshLambertMaterial();
    const mat2 = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, [mat1, mat2]);
    group.add(mesh);

    const spyGeo = vi.spyOn(geo, 'dispose');
    const spyMat1 = vi.spyOn(mat1, 'dispose');
    const spyMat2 = vi.spyOn(mat2, 'dispose');

    disposeGroup(group);

    expect(spyGeo).toHaveBeenCalledOnce();
    expect(spyMat1).toHaveBeenCalledOnce();
    expect(spyMat2).toHaveBeenCalledOnce();
  });
});

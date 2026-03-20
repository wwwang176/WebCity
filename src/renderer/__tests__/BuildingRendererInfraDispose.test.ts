import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeGroup } from '../disposeGroup';

/**
 * Integration test: infra group disposal during BuildingRenderer rebuild.
 * Simulates what happens when disposeNonPersistent traverses infraGroups.
 */
describe('BuildingRenderer infra group disposal', () => {
  it('disposeGroup releases all geometry and material in a typical infra building', () => {
    // Simulate a power plant infrastructure group with multiple meshes
    const group = new THREE.Group();

    // Main building body
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Chimney
    const chimneyGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.3, 8);
    const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    group.add(new THREE.Mesh(chimneyGeo, chimneyMat));

    // Roof
    const roofGeo = new THREE.BoxGeometry(0.55, 0.04, 0.55);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    group.add(new THREE.Mesh(roofGeo, roofMat));

    const disposeSpies = group.children.map(child => {
      const mesh = child as THREE.Mesh;
      return {
        geo: vi.spyOn(mesh.geometry, 'dispose'),
        mat: vi.spyOn(mesh.material as THREE.Material, 'dispose'),
      };
    });

    disposeGroup(group);

    for (const spy of disposeSpies) {
      expect(spy.geo).toHaveBeenCalledOnce();
      expect(spy.mat).toHaveBeenCalledOnce();
    }
  });

  it('disposes multiple infra groups (simulating full rebuild)', () => {
    const groups: THREE.Group[] = [];

    // Create 3 infra buildings
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial();
      g.add(new THREE.Mesh(geo, mat));
      groups.push(g);
    }

    const allSpies = groups.flatMap(g =>
      g.children.map(child => {
        const mesh = child as THREE.Mesh;
        return {
          geo: vi.spyOn(mesh.geometry, 'dispose'),
          mat: vi.spyOn(mesh.material as THREE.Material, 'dispose'),
        };
      }),
    );

    // Simulate disposeNonPersistent loop
    for (const group of groups) {
      disposeGroup(group);
    }

    for (const spy of allSpies) {
      expect(spy.geo).toHaveBeenCalledOnce();
      expect(spy.mat).toHaveBeenCalledOnce();
    }
  });
});

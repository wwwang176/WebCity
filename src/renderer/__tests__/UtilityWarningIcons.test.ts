import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import type { WarnedCell } from '../../core/building/BuildingUtilityWarning';
import { UTILITY_WARNING_COLORS } from '../../core/building/BuildingUtilityWarning';

/**
 * The core half of this feature — which buildings have stopped — is covered by
 * BuildingUtilityWarning.test.ts. This is the half that decides whether the
 * player ever sees it, and it was the half missing from the zone-overlay work:
 * that diagnosis had no renderer test at all, so the one call site that forgot
 * to pass the lookup went unnoticed until an adversarial review found it.
 */
describe('outage badges reach the screen', () => {
  let scene: THREE.Scene;
  let renderer: BuildingRenderer;

  const warned: WarnedCell[] = [
    { x: 3, y: 4, warning: 'NO_POWER' },
    { x: 5, y: 4, warning: 'NO_POWER' },
    { x: 9, y: 2, warning: 'NO_WATER' },
  ];

  /** The badge meshes currently in the scene. */
  const badges = () => scene.children.filter(
    (o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && 'warnCells' in o.userData,
  );
  const icons = () => badges().filter(m => m.userData['isIcon'] === true);

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new BuildingRenderer();
  });

  it('should add a badge for every warned building, grouped by warning', () => {
    renderer.setUtilityWarnings(scene, warned);

    // One plate + one icon per warning kind present.
    expect(badges()).toHaveLength(4);
    const iconMeshes = icons();
    expect(iconMeshes).toHaveLength(2);

    const counts = iconMeshes.map(m => m.count).sort();
    expect(counts).toEqual([1, 2]);
    expect(renderer.getUtilityWarnings()).toEqual(warned);
  });

  it('should colour each icon by its warning', () => {
    renderer.setUtilityWarnings(scene, warned);
    const colours = icons().map(m => (m.material as THREE.MeshBasicMaterial).color.getHex()).sort();
    expect(colours).toEqual(
      [UTILITY_WARNING_COLORS.NO_POWER, UTILITY_WARNING_COLORS.NO_WATER].sort(),
    );
  });

  it('should draw over whatever is in front of it', () => {
    // The badge is a HUD marker, not a thing in the world. Drawn with depth
    // testing on, the building it belongs to — and every taller neighbour —
    // hid it, so the one building that had actually stopped was the hardest to
    // see. renderOrder alone does not fix that; depth testing has to be off.
    renderer.setUtilityWarnings(scene, warned);
    for (const mesh of badges()) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      expect(mat.depthTest, 'badges must not be occluded by geometry').toBe(false);
      expect(mat.depthWrite).toBe(false);
      expect(mesh.renderOrder).toBeGreaterThan(0);
    }
  });

  it('should keep the icon inside its plate', () => {
    // The bolt as drawn reaches a radius of ~0.46 against a plate of 0.34, so
    // its tips hung outside the disc top and bottom and it read as a shape with
    // something behind it rather than as a badge. The fit is measured from the
    // geometry, so this also catches a future edit to the path.
    renderer.setUtilityWarnings(scene, warned);

    const radiusOf = (m: THREE.InstancedMesh) => {
      m.geometry.computeBoundingSphere();
      return m.geometry.boundingSphere!.radius;
    };
    const plateRadius = radiusOf(badges().find(m => m.userData['isIcon'] === false)!);

    for (const icon of icons()) {
      const r = radiusOf(icon);
      expect(r, 'icon spills outside the plate').toBeLessThan(plateRadius);
      // ...but still fills it enough to be recognisable.
      expect(r).toBeGreaterThan(plateRadius * 0.4);
    }
  });

  it('should be small enough not to swallow its own cell', () => {
    // A full-size badge covered most of the tile, so a street of blacked-out
    // houses turned into a row of overlapping icons with no way to tell which
    // building each belonged to.
    renderer.setUtilityWarnings(scene, warned);
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    for (const mesh of badges()) {
      renderer.updateUtilityWarnings(new THREE.Quaternion());
      mesh.getMatrixAt(0, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      expect(scale.x).toBeLessThan(0.8);
      expect(scale.x).toBeGreaterThan(0.1);
    }
  });

  it('should put each badge over its own cell, above the rooftops', () => {
    renderer.setUtilityWarnings(scene, warned);
    renderer.updateUtilityWarnings(new THREE.Quaternion());

    const seen: Array<[number, number]> = [];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const mesh of icons()) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        pos.setFromMatrixPosition(m);
        seen.push([Math.round(pos.x), Math.round(pos.z)]);
        // Tallest building geometry in this renderer is well under 1 unit.
        expect(pos.y).toBeGreaterThan(1);
      }
    }
    expect(seen.sort()).toEqual([[3, 4], [5, 4], [9, 2]]);
  });

  it('should turn to face the camera when it rotates', () => {
    // The camera is orthographic and rotates on Q/E. A badge that keeps its
    // original facing turns edge-on and disappears at some angles.
    renderer.setUtilityWarnings(scene, warned);

    const facing = (q: THREE.Quaternion) => {
      renderer.updateUtilityWarnings(q);
      const m = new THREE.Matrix4();
      icons()[0]!.getMatrixAt(0, m);
      const out = new THREE.Quaternion();
      m.decompose(new THREE.Vector3(), out, new THREE.Vector3());
      return out;
    };

    const straight = new THREE.Quaternion();
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);

    expect(facing(straight).angleTo(straight)).toBeLessThan(1e-6);
    expect(facing(turned).angleTo(turned)).toBeLessThan(1e-6);
  });

  it('should not rewrite the matrices while the camera holds still', () => {
    renderer.setUtilityWarnings(scene, warned);
    const q = new THREE.Quaternion();
    renderer.updateUtilityWarnings(q);

    // `needsUpdate` is write-only in Three.js; it bumps `version`, which is
    // what actually triggers the GPU upload.
    const mesh = icons()[0]!;
    const before = mesh.instanceMatrix.version;
    for (let i = 0; i < 5; i++) renderer.updateUtilityWarnings(q);
    expect(mesh.instanceMatrix.version).toBe(before);

    renderer.updateUtilityWarnings(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5),
    );
    expect(mesh.instanceMatrix.version).toBeGreaterThan(before);
  });

  it('should blink, and never all the way to invisible', () => {
    renderer.setUtilityWarnings(scene, warned);
    const q = new THREE.Quaternion();
    const mat = () => icons()[0]!.material as THREE.MeshBasicMaterial;

    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      // update() advances the clock the pulse is derived from.
      renderer.update(1, 1 / 12);
      renderer.updateUtilityWarnings(q);
      samples.push(mat().opacity);
    }

    // It has to actually move, or it is not a blink.
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    // ...and never vanish between beats, or the player can miss it entirely.
    expect(Math.min(...samples)).toBeGreaterThan(0.05);
  });

  it('should clear every badge when the outage ends', () => {
    renderer.setUtilityWarnings(scene, warned);
    expect(badges().length).toBeGreaterThan(0);

    renderer.setUtilityWarnings(scene, []);
    expect(badges()).toHaveLength(0);
    expect(renderer.getUtilityWarnings()).toHaveLength(0);
    // A no-op update on an empty set must not throw.
    expect(() => renderer.updateUtilityWarnings(new THREE.Quaternion())).not.toThrow();
  });

  it('should not leak meshes across refreshes', () => {
    for (let i = 0; i < 6; i++) renderer.setUtilityWarnings(scene, warned);
    expect(badges()).toHaveLength(4);
  });
});

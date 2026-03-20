import * as THREE from 'three';

/**
 * Traverse a THREE.Group and dispose all child mesh geometries and materials.
 * Prevents GPU memory leaks when removing groups from the scene.
 */
export function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else if (mat instanceof THREE.Material) {
        mat.dispose();
      }
    }
  });
}

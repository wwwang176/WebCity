import * as THREE from 'three';

/**
 * Focus mode's white model: everything on the ground is flattened to a translucent neutral grey so
 * what lies beneath, or what is focused, becomes visible.
 *
 * Whitening writes the material's `color` directly, and each material's original colour is written
 * only on the line that creates it. This captures that colour into `userData.baseColor` before the
 * first change, so there is something to write back on restore; with each caller recording its own
 * hex value, changing the constructed colour desynchronises it from the restored one.
 */

/** The neutral grey laid over everything once whitened. */
export const DIM_TINT = 0xcccccc;

/** Translucent objects' render order, after every opaque one. */
export const DIM_RENDER_ORDER = 20;

/** A material with an adjustable `color` and opacity. */
type DimmableMaterial = THREE.Material & {
  color: THREE.Color;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
};

/**
 * Switches a material into the translucent white model (`opacity < 1`) or back to its original
 * appearance (`opacity >= 1`).
 */
export function setMaterialDim(mat: DimmableMaterial, opacity: number, tint = DIM_TINT): void {
  if (mat.userData.baseColor === undefined) mat.userData.baseColor = mat.color.getHex();
  if (opacity < 1.0) {
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    mat.color.setHex(tint);
  } else {
    mat.transparent = false;
    mat.opacity = 1.0;
    mat.depthWrite = true;
    mat.color.setHex(mat.userData.baseColor as number);
  }
}

/** Handles the material and the render order together. Meshes with multiple materials are not supported. */
export function setMeshDim(
  mesh: THREE.Mesh | THREE.InstancedMesh, opacity: number, tint = DIM_TINT,
): void {
  setMaterialDim(mesh.material as DimmableMaterial, opacity, tint);
  mesh.renderOrder = opacity < 1.0 ? DIM_RENDER_ORDER : 0;
}

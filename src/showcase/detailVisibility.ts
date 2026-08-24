import type * as THREE from 'three';
import { detailHidden } from '../renderer/detailLOD';

/**
 * The showcase's distance culling of detail.
 *
 * The game holds ground props and overhangs in `InstancedLayer`s and gates whole layers; the showcase
 * draws plain `Mesh` nodes that gate cannot reach. So this remembers which meshes belong to the two
 * cullable layers while the decision itself stays shared with `renderer/detailLOD`: there can be only
 * one copy of the thresholds and the hysteresis.
 *
 * The decal layer stays out: it is flat paving and carries the sense that there is something on the
 * ground (see BUG-231).
 */
export class DetailVisibility {
  private readonly meshes: THREE.Object3D[] = [];
  private hidden = false;

  get size(): number { return this.meshes.length; }
  get isHidden(): boolean { return this.hidden; }

  /**
   * Takes an object under management and applies the current state to it immediately.
   *
   * Applying it immediately is the point: touching a control redraws everything, and if everything
   * redrawn is `visible = true`, moving a slider while zoomed out brings all the detail back. This is
   * the same trap `InstancedLayer.acquire` holds on the game's side.
   */
  add(mesh: THREE.Object3D): void {
    mesh.visible = !this.hidden;
    this.meshes.push(mesh);
  }

  /** Releases every reference. The showcase disposes the old meshes on every redraw. */
  clear(): void {
    this.meshes.length = 0;
  }

  /** Updates from the camera's frustum height. Does nothing when the state is unchanged. */
  update(frustumHeight: number): void {
    const hidden = detailHidden(frustumHeight, this.hidden);
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    for (const mesh of this.meshes) mesh.visible = !hidden;
  }
}

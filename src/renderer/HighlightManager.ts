import * as THREE from 'three';

/**
 * Inject per-instance highlight support into a MeshLambertMaterial.
 * Adds aHighlight attribute reading + color tinting via onBeforeCompile.
 * Also adds a uHighlightColor uniform to the material's userData for later access.
 */
export function injectHighlightShader(material: THREE.MeshLambertMaterial): void {
  const highlightColor = new THREE.Color(1, 0, 0);
  material.userData.uHighlightColor = { value: highlightColor };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHighlightColor = material.userData.uHighlightColor;

    // Vertex: pass aHighlight to fragment
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute float aHighlight;
      varying float vHighlight;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vHighlight = aHighlight;`,
    );

    // Fragment: mix highlight color when flagged
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform vec3 uHighlightColor;
      varying float vHighlight;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      if (vHighlight > 0.5) {
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHighlightColor, 0.22);
        gl_FragColor.rgb += uHighlightColor * 0.12;
      }`,
    );
  };
}

/** Add aHighlight InstancedBufferAttribute to an InstancedMesh. */
export function addHighlightAttribute(mesh: THREE.InstancedMesh): void {
  const data = new Float32Array(mesh.count);
  mesh.geometry.setAttribute('aHighlight',
    new THREE.InstancedBufferAttribute(data, 1));
}

/**
 * Manages highlight tinting for grid cells and the 3D objects on them.
 * - Ground: semi-transparent flat overlay plane
 * - Infrastructure (THREE.Group): emissive material tinting
 * - Zone buildings (InstancedMesh): per-instance shader attribute (aHighlight)
 * - Roads / Rails (InstancedMesh): per-instance via injected Lambert shader
 */
export class HighlightManager {
  private scene: THREE.Scene;
  private getElevation: (x: number, y: number) => number;

  // Ground overlay
  private groundOverlay: THREE.Mesh | null = null;
  private groundMaterial: THREE.MeshBasicMaterial | null = null;

  // Infrastructure: original materials saved for restoration
  private infraTinted: { mesh: THREE.Mesh; original: THREE.Material }[] = [];

  // Zone buildings: track which InstancedMeshes were modified for cleanup
  private highlightedMeshes: THREE.InstancedMesh[] = [];

  // Reusable temps
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();

  /** @param getElevation returns raw elevation for grid cell (x,y); world Y = elevation * 0.3 */
  constructor(scene: THREE.Scene, getElevation: (x: number, y: number) => number) {
    this.scene = scene;
    this.getElevation = getElevation;
  }

  /**
   * Highlight a rectangular range of grid cells.
   */
  highlight(
    minX: number, minY: number, maxX: number, maxY: number,
    color: number,
    buildingMeshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    infraGroups: readonly THREE.Group[],
  ): void {
    this.clear();
    this.createGroundOverlay(minX, minY, maxX, maxY, color);
    this.tintInfraGroups(infraGroups, minX, minY, maxX, maxY, color);
    this.setInstanceHighlights(buildingMeshes, color,
      (gx, gz) => gx >= minX && gx <= maxX && gz >= minY && gz <= maxY);
  }

  /**
   * Highlight specific cells (non-rectangular, e.g. multi-cell building footprint).
   */
  highlightCells(
    cells: { x: number; y: number }[],
    color: number,
    buildingMeshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    infraGroups: readonly THREE.Group[],
  ): void {
    if (cells.length === 0) return;
    this.clear();

    const cellSet = new Set<string>();
    for (const c of cells) cellSet.add(`${c.x},${c.y}`);

    this.createCellOverlays(cells, color);
    this.tintInfraGroupsByCells(infraGroups, cellSet, color);
    this.setInstanceHighlights(buildingMeshes, color,
      (gx, gz) => cellSet.has(`${gx},${gz}`));
  }

  clear(): void {
    // Restore infrastructure materials
    for (const { mesh, original } of this.infraTinted) {
      if (mesh.material !== original) {
        (mesh.material as THREE.Material).dispose();
      }
      mesh.material = original;
    }
    this.infraTinted.length = 0;

    // Clear instance highlight attributes
    for (const mesh of this.highlightedMeshes) {
      const attr = mesh.geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute | undefined;
      if (attr) {
        (attr.array as Float32Array).fill(0);
        attr.needsUpdate = true;
      }
    }
    this.highlightedMeshes.length = 0;

    // Remove ground overlay
    this.disposeGroundOverlay();
  }

  dispose(): void {
    this.clear();
    if (this.groundMaterial) {
      this.groundMaterial.dispose();
      this.groundMaterial = null;
    }
  }

  // ─── Ground overlay ──────────────────────────────────────────────

  private static readonly OVERLAY_Y_OFFSET = 0.02;

  private createGroundOverlay(minX: number, minY: number, maxX: number, maxY: number, color: number): void {
    const cells: { x: number; y: number }[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells.push({ x, y });
      }
    }
    this.createCellOverlays(cells, color);
  }

  private createCellOverlays(cells: { x: number; y: number }[], color: number): void {
    if (cells.length === 0) return;

    if (!this.groundMaterial) {
      this.groundMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }
    this.groundMaterial.color.set(color);

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const instanceMesh = new THREE.InstancedMesh(geo, this.groundMaterial, cells.length);
    instanceMesh.frustumCulled = false;
    instanceMesh.renderOrder = 1;
    const mat4 = new THREE.Matrix4();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const y = this.getElevation(c.x, c.y) * 0.3 + HighlightManager.OVERLAY_Y_OFFSET;
      mat4.setPosition(c.x, y, c.y);
      instanceMesh.setMatrixAt(i, mat4);
    }
    instanceMesh.instanceMatrix.needsUpdate = true;
    this.groundOverlay = instanceMesh as unknown as THREE.Mesh;
    this.scene.add(instanceMesh);
  }

  private disposeGroundOverlay(): void {
    if (this.groundOverlay) {
      this.scene.remove(this.groundOverlay);
      this.groundOverlay.geometry.dispose();
      this.groundOverlay = null;
    }
  }

  // ─── Infrastructure tinting ──────────────────────────────────────

  private tintInfraGroups(
    groups: readonly THREE.Group[], minX: number, minY: number, maxX: number, maxY: number, color: number,
  ): void {
    for (const group of groups) {
      const gx = group.position.x;
      const gz = group.position.z;
      if (gx >= minX - 1 && gx <= maxX + 1 && gz >= minY - 1 && gz <= maxY + 1) {
        this.applyTintToGroup(group, color);
      }
    }
  }

  private tintInfraGroupsByCells(
    groups: readonly THREE.Group[], cellSet: Set<string>, color: number,
  ): void {
    for (const group of groups) {
      const gx = Math.round(group.position.x);
      const gz = Math.round(group.position.z);
      if (cellSet.has(`${gx},${gz}`)) {
        this.applyTintToGroup(group, color);
      }
    }
  }

  private applyTintToGroup(group: THREE.Group, color: number): void {
    const tint = new THREE.Color(color);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const origMat = child.material as THREE.Material;
      const cloned = origMat.clone();

      if (cloned instanceof THREE.MeshLambertMaterial) {
        cloned.color.lerp(tint, 0.25);
        cloned.emissive.set(color);
        cloned.emissiveIntensity = 0.5;
      } else if (cloned instanceof THREE.MeshBasicMaterial) {
        cloned.color.lerp(tint, 0.5);
      }

      this.infraTinted.push({ mesh: child, original: origMat });
      child.material = cloned;
    });
  }

  // ─── Zone building instance highlights ───────────────────────────

  /**
   * Set aHighlight attribute and uHighlightColor uniform on zone building InstancedMeshes.
   */
  private setInstanceHighlights(
    meshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    color: number,
    inRange: (gx: number, gz: number) => boolean,
  ): void {
    for (const mesh of meshes) {
      if (!(mesh instanceof THREE.InstancedMesh)) continue;
      const attr = mesh.geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute | undefined;
      if (!attr) continue; // skip meshes without highlight attribute (zone overlays, light spots)

      // Set highlight color uniform on the material
      // ShaderMaterial (custom building shader): uniforms on material directly
      // MeshLambertMaterial (road/track via onBeforeCompile): uniforms in userData
      const mat = mesh.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uHighlightColor) {
        (mat.uniforms.uHighlightColor.value as THREE.Color).set(color);
      } else if ((mesh.material as THREE.Material).userData?.uHighlightColor) {
        ((mesh.material as THREE.Material).userData.uHighlightColor.value as THREE.Color).set(color);
      }

      const data = attr.array as Float32Array;
      let anySet = false;

      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, this._mat4);
        this._pos.setFromMatrixPosition(this._mat4);
        const gx = Math.round(this._pos.x);
        const gz = Math.round(this._pos.z);

        if (inRange(gx, gz)) {
          data[i] = 1.0;
          anySet = true;
        }
      }

      if (anySet) {
        attr.needsUpdate = true;
        this.highlightedMeshes.push(mesh);
      }
    }
  }
}

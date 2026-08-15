import * as THREE from 'three';

/**
 * Inject per-instance highlight support into a MeshLambertMaterial.
 * Adds aHighlight attribute reading + color tinting via onBeforeCompile.
 * Also adds a uHighlightColor uniform to the material's userData for later access.
 */
export function injectHighlightShader(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    // Vertex: pass aHighlight + aHighlightColor to fragment
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute float aHighlight;
      attribute vec3 aHighlightColor;
      varying float vHighlight;
      varying vec3 vHighlightColor;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vHighlight = aHighlight;
      vHighlightColor = aHighlightColor;`,
    );

    // Fragment: mix per-instance highlight color when flagged
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying float vHighlight;
      varying vec3 vHighlightColor;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      if (vHighlight > 0.01) {
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vHighlightColor, 0.22 * vHighlight);
        gl_FragColor.rgb += vHighlightColor * 0.12 * vHighlight;
        gl_FragColor.a = max(gl_FragColor.a, vHighlight);
      }`,
    );
  };
}

/** Add aHighlight + aHighlightColor InstancedBufferAttributes to an InstancedMesh. */
export function addHighlightAttribute(mesh: THREE.InstancedMesh): void {
  const data = new Float32Array(mesh.count);
  mesh.geometry.setAttribute('aHighlight',
    new THREE.InstancedBufferAttribute(data, 1));
  const colorData = new Float32Array(mesh.count * 3);
  mesh.geometry.setAttribute('aHighlightColor',
    new THREE.InstancedBufferAttribute(colorData, 3));
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

  /**
   * 寫過 `aHighlight` 的 mesh，`clear()` 要把它們歸零。
   *
   * 分區建築是 `InstancedMesh`（逐實例），公共建築是普通的 `Mesh`
   * （逐頂點）—— 兩者在這裡沒有差別：都是把那一份陣列填 0。
   */
  private highlightedMeshes: (THREE.InstancedMesh | THREE.Mesh)[] = [];

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
      const attr = mesh.geometry.getAttribute('aHighlight') as THREE.BufferAttribute | undefined;
      if (attr) {
        (attr.array as Float32Array).fill(0);
        attr.needsUpdate = true;
      }
      const colorAttr = mesh.geometry.getAttribute('aHighlightColor') as THREE.BufferAttribute | undefined;
      if (colorAttr) {
        (colorAttr.array as Float32Array).fill(0);
        colorAttr.needsUpdate = true;
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
    groups: readonly THREE.Group[], cellSet: Set<string>, color: number, intensity: number = 1.0,
  ): void {
    for (const group of groups) {
      const gx = Math.round(group.position.x);
      const gz = Math.round(group.position.z);
      if (cellSet.has(`${gx},${gz}`)) {
        this.applyTintToGroup(group, color, intensity);
      }
    }
  }

  /** 同上，但顏色逐格查表 —— 漸層高亮下每一棟的顏色都不一樣。 */
  private tintInfraGroupsByCellColor(
    groups: readonly THREE.Group[], cellMap: ReadonlyMap<string, number>, intensity: number,
  ): void {
    for (const group of groups) {
      const gx = Math.round(group.position.x);
      const gz = Math.round(group.position.z);
      const color = cellMap.get(`${gx},${gz}`);
      if (color !== undefined) this.applyTintToGroup(group, color, intensity);
    }
  }

  /**
   * 一棟公共建築的高亮。
   *
   * 走 `aHighlight` / `aHighlightColor` —— 建築 shader 本來就吃這兩個屬性，
   * 分區建築走的就是那條路。公共建築改用同一個 shader 之後，這裡原本的
   * `MeshLambertMaterial` / `MeshBasicMaterial` 兩個分支**都不中**，
   * 高亮會靜默失效。
   *
   * 而補上第三個分支也是錯的：clone 出來的材質是另一個 `ShaderMaterial`
   * 實例，收不到每幀寫進單例的 `uTime` —— 被高亮過的那一棟窗戶會凍結在
   * 某個亮燈狀態，而且再也不會動。
   *
   * 只有停放的車輛（走 `MeshLambertMaterial`）還走 clone 那條路。
   */
  private applyTintToGroup(group: THREE.Group, color: number, intensity: number = 1.0): void {
    const tint = new THREE.Color(color);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const attr = child.geometry.getAttribute('aHighlight');
      if (attr) {
        (attr.array as Float32Array).fill(intensity);
        attr.needsUpdate = true;
        const colorAttr = child.geometry.getAttribute('aHighlightColor');
        if (colorAttr) {
          const arr = colorAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i += 3) {
            arr[i] = tint.r;
            arr[i + 1] = tint.g;
            arr[i + 2] = tint.b;
          }
          colorAttr.needsUpdate = true;
        }
        if (!this.highlightedMeshes.includes(child)) this.highlightedMeshes.push(child);
        return;
      }

      // If already tinted, retrieve original; otherwise save it
      const existing = this.infraTinted.find(e => e.mesh === child);
      let origMat: THREE.Material;
      if (existing) {
        origMat = existing.original;
        // Dispose the previous tinted material
        if (child.material !== origMat) {
          (child.material as THREE.Material).dispose();
        }
      } else {
        origMat = child.material as THREE.Material;
        this.infraTinted.push({ mesh: child, original: origMat });
      }

      const cloned = origMat.clone();
      if (cloned instanceof THREE.MeshLambertMaterial) {
        cloned.color.lerp(tint, 0.25 * intensity);
        cloned.emissive.set(color);
        cloned.emissiveIntensity = 0.5 * intensity;
      } else if (cloned instanceof THREE.MeshBasicMaterial) {
        cloned.color.lerp(tint, 0.5 * intensity);
      }

      child.material = cloned;
    });
  }

  // ─── Hover highlight (instance attribute only, no overlays) ─────

  /**
   * Lightweight hover highlight: sets instance aHighlight attribute + infra tint.
   * Does NOT call clear() or create ground overlays.
   * Uses Math.max so it won't overwrite a higher-intensity selection highlight.
   */
  hoverHighlight(
    cells: { x: number; y: number }[],
    color: number,
    meshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    infraGroups: readonly THREE.Group[],
    intensity: number = 0.3,
  ): void {
    if (cells.length === 0) return;
    const cellSet = new Set<string>();
    for (const c of cells) cellSet.add(`${c.x},${c.y}`);
    this.tintInfraGroupsByCells(infraGroups, cellSet, color, intensity);
    this.setInstanceHighlights(meshes, color,
      (gx, gz) => cellSet.has(`${gx},${gz}`), intensity);
  }

  /**
   * Hover highlight with per-cell gradient colors (coverage preview).
   * Each cell gets its own color via per-instance aHighlightColor attribute.
   */
  hoverHighlightGradient(
    cells: { x: number; y: number; color: number }[],
    meshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    infraGroups: readonly THREE.Group[],
    intensity: number = 0.6,
  ): void {
    if (cells.length === 0) return;
    const cellMap = new Map<string, number>();
    for (const c of cells) cellMap.set(`${c.x},${c.y}`, c.color);

    // 每一棟公共建築拿**自己那一格**的顏色。原本一律用 cells[0] —— 通勤圖層把
    // 站牌標成青色、住宅標成漸層色，於是所有交通建築都被塗成第一個住宅格的
    // 顏色，那一格通勤很糟的話就是全城的公共建築一起變紅。
    if (infraGroups.length > 0) {
      this.tintInfraGroupsByCellColor(infraGroups, cellMap, intensity);
    }

    this.setInstanceHighlights(meshes,
      (gx, gz) => cellMap.get(`${gx},${gz}`) ?? 0xff0000,
      (gx, gz) => cellMap.has(`${gx},${gz}`), intensity);
  }

  // ─── Zone building instance highlights ───────────────────────────

  /**
   * Set aHighlight + aHighlightColor per-instance attributes on zone building InstancedMeshes.
   * @param color single color for all highlighted instances, or a function (gx,gz)=>number for per-instance color.
   * @param intensity highlight intensity (0.0–1.0); last-writer-wins (later layers overwrite earlier ones).
   */
  private setInstanceHighlights(
    meshes: readonly (THREE.InstancedMesh | THREE.Mesh)[],
    color: number | ((gx: number, gz: number) => number),
    inRange: (gx: number, gz: number) => boolean,
    intensity: number = 1.0,
  ): void {
    const isColorFn = typeof color === 'function';
    const fixedColor = isColorFn ? null : new THREE.Color(color);

    for (const mesh of meshes) {
      if (!(mesh instanceof THREE.InstancedMesh)) continue;
      const attr = mesh.geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute | undefined;
      if (!attr) continue; // skip meshes without highlight attribute (zone overlays, light spots)

      const colorAttr = mesh.geometry.getAttribute('aHighlightColor') as THREE.InstancedBufferAttribute | undefined;

      const data = attr.array as Float32Array;
      const colorData = colorAttr ? colorAttr.array as Float32Array : null;
      let anySet = false;
      const tmpColor = new THREE.Color();

      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, this._mat4);
        this._pos.setFromMatrixPosition(this._mat4);
        const gx = Math.round(this._pos.x);
        const gz = Math.round(this._pos.z);

        if (inRange(gx, gz)) {
          data[i] = intensity;
          anySet = true;

          // Set per-instance color
          if (colorData) {
            if (isColorFn) {
              tmpColor.set(color(gx, gz));
            } else {
              tmpColor.copy(fixedColor!);
            }
            colorData[i * 3] = tmpColor.r;
            colorData[i * 3 + 1] = tmpColor.g;
            colorData[i * 3 + 2] = tmpColor.b;
          }
        }
      }

      if (anySet) {
        attr.needsUpdate = true;
        if (colorAttr) colorAttr.needsUpdate = true;
        if (!this.highlightedMeshes.includes(mesh)) {
          this.highlightedMeshes.push(mesh);
        }
      }
    }
  }
}

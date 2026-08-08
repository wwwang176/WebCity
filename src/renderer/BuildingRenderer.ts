import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { getBuildingMaterial } from './BuildingMaterial';
import { paletteFor } from './ColorPalettes';
import { appearanceOf } from './BuildingAppearance';
import {
  getVariants, ZONE_TYPES, LEVELS, TARGET_HEIGHTS_M, heightKey, heightScaleFor,
  bucketKey, type Density,
} from './geometry/buildings/registry';
import { stampZoneCategory, ZONE_CAT, tagPart, PART_WALL, PART_FOLIAGE, PART_ROOF } from './geometry/buildings/parts';
import { ZoneType } from '../core/grid/types';
import { getInfraConfig, getInfraConfigById, getRotatedSize, isZoneBuilding, type InfraType, type Rotation } from '../core/building/InfraConfig';
import { getBuildingType } from '../core/building/types';
import { ViewMode } from '../core/ViewMode';
import { RESERVED_TO_ROTATION, MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../core/building/InfraPlacement';
import { disposeGroup } from './disposeGroup';
import { PALETTE } from '../ColorPalette';
import { ZONE_BLOCKER_COLORS, ACTIONABLE_BLOCKERS, type ZoneBlocker } from '../core/zone/ZoneBlocker';
import { UTILITY_WARNING_COLORS, type UtilityWarning, type WarnedCell } from '../core/building/BuildingUtilityWarning';

interface BuildingData { x: number; y: number; level: number; burned?: boolean }

export class BuildingRenderer {
  // --- Persistent variant meshes (pre-allocated, never disposed until game exit) ---
  private variantMeshes = new Map<string, THREE.InstancedMesh>();
  private variantCounts = new Map<string, number>();
  private positionToInstance = new Map<string, { key: string; idx: number }>();
  private instanceToPosition = new Map<string, Map<number, string>>();
  private variantInitialized = false;

  // --- Non-persistent meshes (zone overlays, rebuilt each build) ---
  private overlayMeshes: THREE.InstancedMesh[] = [];
  private overlayIndex = new Map<string, { mesh: THREE.InstancedMesh; idx: number }>();

  // --- Infrastructure groups (now with index for lookup) ---
  private infraGroups: THREE.Group[] = [];
  private infraIndex = new Map<string, THREE.Group>();

  private readonly maxPerVariant = 6000;

  // Light spot system (fake ground glow near buildings at night)
  private lightSpotMesh: THREE.InstancedMesh | null = null;
  private lightSpotMaterial: THREE.MeshBasicMaterial | null = null;
  private lightSpotPosToIdx = new Map<string, number>();
  private lightSpotIdxToPos: string[] = [];
  private lightSpotCount = 0;

  // Pre-allocated temp objects (avoid per-call allocation)
  private _matrix = new THREE.Matrix4();
  private _scale = new THREE.Matrix4();
  private _rotation = new THREE.Matrix4();
  private _color = new THREE.Color();

  /** Cached building meshes array (invalidated on build/dispose). */
  private _buildingMeshesCache: (THREE.InstancedMesh | THREE.Mesh)[] = [];
  private _buildingMeshesDirty = true;

  /** Expose building meshes for highlight tinting (read-only). */
  get buildingMeshes(): readonly (THREE.InstancedMesh | THREE.Mesh)[] {
    if (this._buildingMeshesDirty) {
      this._buildingMeshesDirty = false;
      const arr = this._buildingMeshesCache;
      arr.length = 0;
      for (const m of this.variantMeshes.values()) arr.push(m);
      for (const m of this.overlayMeshes) arr.push(m);
    }
    return this._buildingMeshesCache;
  }

  /** Expose infrastructure groups for highlight tinting (read-only). */
  get buildingInfraGroups(): readonly THREE.Group[] { return this.infraGroups; }

  // ─── Persistent variant mesh initialization ─────────────────────

  /** Pre-allocate all variant InstancedMeshes (called once). */
  private initVariantMeshes(scene: THREE.Scene): void {
    if (this.variantInitialized) return;
    this.variantInitialized = true;

    const material = getBuildingMaterial();

    for (const zoneType of ZONE_TYPES) {
      const zoneCat = ZONE_CAT[zoneType] ?? 0;
      for (const density of ['LOW', 'HIGH'] as Density[]) {
        // 只有辦公區兩種密度都有建築；其餘分區各只有一種。
        if (!TARGET_HEIGHTS_M[heightKey(zoneType, density)]) continue;
        for (const level of LEVELS) {
      const variants = getVariants(zoneType, level);

      for (let vi = 0; vi < variants.length; vi++) {
        const key = bucketKey(zoneType, density, level, vi);
        const geo = variants[vi]!();
        stampZoneCategory(geo, zoneCat);

        const mesh = new THREE.InstancedMesh(geo, material, this.maxPerVariant);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        // Pre-allocate aHighlight + aHighlightColor attributes
        const highlightData = new Float32Array(this.maxPerVariant);
        mesh.geometry.setAttribute('aHighlight',
          new THREE.InstancedBufferAttribute(highlightData, 1));
        const highlightColorData = new Float32Array(this.maxPerVariant * 3);
        mesh.geometry.setAttribute('aHighlightColor',
          new THREE.InstancedBufferAttribute(highlightColorData, 3));

        // Pre-allocate aOccupancy attribute (0.0 = empty, 1.0 = full)
        const occupancyData = new Float32Array(this.maxPerVariant);
        mesh.geometry.setAttribute('aOccupancy',
          new THREE.InstancedBufferAttribute(occupancyData, 1));

        // 逐實例立面種子：節奏、相位、材質偏好。shader 用它取代寫死的
        // floorH / winW，讓同一份幾何的兩個實例立面不同。
        const seedData = new Float32Array(this.maxPerVariant * 3);
        mesh.geometry.setAttribute('aSeed',
          new THREE.InstancedBufferAttribute(seedData, 3));

        scene.add(mesh);
        this.variantMeshes.set(key, mesh);
        this.variantCounts.set(key, 0);
        this.instanceToPosition.set(key, new Map());
      }
        }
      }
    }
  }

  // ─── Incremental building operations ───────────────────────────

  /** Add a single zone building instance. */
  addBuilding(
    x: number, y: number, zoneType: number, density: Density,
    level: number, burned: boolean, abandoned = false,
  ): void {
    const variants = getVariants(zoneType, level);
    if (variants.length === 0) return;

    const palette = paletteFor(zoneType, level);
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: variants.length, paletteSize: palette.length,
    });
    const key = bucketKey(zoneType, density, level, app.variantIndex);
    const mesh = this.variantMeshes.get(key);
    if (!mesh) return;

    const idx = this.variantCounts.get(key)!;
    if (idx >= this.maxPerVariant) return;

    this.setInstanceData(mesh, idx, x, y, zoneType, density, level, burned, abandoned);

    this.variantCounts.set(key, idx + 1);
    mesh.count = idx + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const posKey = `${x},${y}`;
    this.positionToInstance.set(posKey, { key, idx });
    this.instanceToPosition.get(key)!.set(idx, posKey);

    // Sync lightSpot (non-burned, non-abandoned buildings emit light)
    if (!burned && !abandoned) this.addLightSpot(x, y);
  }

  /** Remove a single zone building instance (swap-with-last). */
  removeBuilding(x: number, y: number): void {
    const posKey = `${x},${y}`;
    const entry = this.positionToInstance.get(posKey);
    if (!entry) return;

    const mesh = this.variantMeshes.get(entry.key)!;
    const lastIdx = this.variantCounts.get(entry.key)! - 1;
    const i2p = this.instanceToPosition.get(entry.key)!;

    if (entry.idx !== lastIdx) {
      // Swap the last instance into the removed slot
      mesh.getMatrixAt(lastIdx, this._matrix);
      mesh.setMatrixAt(entry.idx, this._matrix);
      mesh.getColorAt(lastIdx, this._color);
      mesh.setColorAt(entry.idx, this._color);

      // Swap aHighlight
      const hlAttr = mesh.geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute;
      (hlAttr.array as Float32Array)[entry.idx] = (hlAttr.array as Float32Array)[lastIdx]!;
      hlAttr.needsUpdate = true;

      // Swap aHighlightColor (vec3 = 3 floats)
      const hlcAttr = mesh.geometry.getAttribute('aHighlightColor') as THREE.InstancedBufferAttribute;
      const hlcArr = hlcAttr.array as Float32Array;
      hlcArr[entry.idx * 3] = hlcArr[lastIdx * 3]!;
      hlcArr[entry.idx * 3 + 1] = hlcArr[lastIdx * 3 + 1]!;
      hlcArr[entry.idx * 3 + 2] = hlcArr[lastIdx * 3 + 2]!;
      hlcAttr.needsUpdate = true;

      // Swap aOccupancy
      const occAttr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
      (occAttr.array as Float32Array)[entry.idx] = (occAttr.array as Float32Array)[lastIdx]!;
      occAttr.needsUpdate = true;

      // Swap aSeed（與 aOccupancy 相同的理由：不搬的話，被搬動的那棟樓會
      // 戴上被移除那棟的立面，而且只在玩家拆除建築之後才發生）
      const seedAttr = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute | undefined;
      if (seedAttr) {
        const arr = seedAttr.array as Float32Array;
        arr[entry.idx * 3] = arr[lastIdx * 3]!;
        arr[entry.idx * 3 + 1] = arr[lastIdx * 3 + 1]!;
        arr[entry.idx * 3 + 2] = arr[lastIdx * 3 + 2]!;
        seedAttr.needsUpdate = true;
      }

      // Update the moved instance's mappings
      const movedPosKey = i2p.get(lastIdx)!;
      this.positionToInstance.set(movedPosKey, { key: entry.key, idx: entry.idx });
      i2p.set(entry.idx, movedPosKey);
    }

    i2p.delete(lastIdx);
    this.positionToInstance.delete(posKey);
    this.variantCounts.set(entry.key, lastIdx);
    mesh.count = lastIdx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Sync lightSpot removal
    this.removeLightSpot(x, y);
  }

  /** Update an existing building's level or burned/abandoned state in-place. */
  updateBuilding(
    x: number, y: number, zoneType: number, density: Density,
    level: number, burned: boolean, abandoned = false,
  ): void {
    const posKey = `${x},${y}`;
    const entry = this.positionToInstance.get(posKey);
    if (!entry) return;

    const mesh = this.variantMeshes.get(entry.key)!;
    this.setInstanceData(mesh, entry.idx, x, y, zoneType, density, level, burned, abandoned);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Sync lightSpot: burned/abandoned → remove, normal → add
    if (burned || abandoned) this.removeLightSpot(x, y);
    else this.addLightSpot(x, y);
  }

  /** Set matrix + color for a single instance. */
  private setInstanceData(
    mesh: THREE.InstancedMesh, idx: number,
    x: number, y: number, zoneType: number, density: Density,
    level: number, burned: boolean, abandoned = false,
  ): void {
    const palette = paletteFor(zoneType, level);
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: getVariants(zoneType, level).length,
      paletteSize: palette.length,
    });

    // 高度來自公尺表，由這個變體自己的未縮放高度反推係數。
    const finalHeight = heightScaleFor(zoneType, density, level, app.variantIndex)
      * app.heightScale;

    this._rotation.makeRotationY((app.rotationQuarter * Math.PI) / 2);
    this._scale.makeScale(app.widthScale, finalHeight, app.depthScale);
    this._matrix.multiplyMatrices(this._scale, this._rotation);
    this._matrix.setPosition(x, 0.05, y);
    mesh.setMatrixAt(idx, this._matrix);

    if (burned) {
      const burnLightness = 0.08 + app.facadeSeed[0] * 0.07;
      this._color.setHSL(0.05, 0.1, burnLightness);
    } else {
      this._color.set(palette[app.paletteIndex]!);
      const hsl = { h: 0, s: 0, l: 0 };
      this._color.getHSL(hsl);
      hsl.h += app.hueShift;
      hsl.s = Math.max(0.05, Math.min(0.6, hsl.s + app.satShift));
      hsl.l = Math.max(0.3, Math.min(0.85, hsl.l + app.lightShift));
      this._color.setHSL(hsl.h, hsl.s, hsl.l);
    }
    mesh.setColorAt(idx, this._color);

    const seedAttr = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute | undefined;
    if (seedAttr) {
      const arr = seedAttr.array as Float32Array;
      arr[idx * 3] = app.facadeSeed[0];
      arr[idx * 3 + 1] = app.facadeSeed[1];
      arr[idx * 3 + 2] = app.facadeSeed[2];
      seedAttr.needsUpdate = true;
    }

    // Force occupancy to 0 for burned/abandoned buildings (all windows dark)
    if (burned || abandoned) {
      const occAttr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
      if (occAttr) {
        (occAttr.array as Float32Array)[idx] = 0;
        occAttr.needsUpdate = true;
      }
    }
  }

  // ─── Incremental infrastructure operations ─────────────────────

  /** Add a single infrastructure building to the scene (O(1), no full rebuild). */
  addInfrastructure(scene: THREE.Scene, x: number, y: number, type: InfraType, reserved: number): void {
    const cfg = getInfraConfig(type);
    const rotationDeg = RESERVED_TO_ROTATION[reserved] ?? 0;
    const { w, h } = cfg
      ? getRotatedSize(cfg.width, cfg.height, rotationDeg as Rotation)
      : { w: 1, h: 1 };
    const centerX = x + (w - 1) / 2;
    const centerZ = y + (h - 1) / 2;

    const group = new THREE.Group();
    group.position.set(centerX, 0, centerZ);
    if (rotationDeg !== 0) {
      group.rotation.y = (rotationDeg * Math.PI) / 180;
    }

    this.buildModel(type, group);

    scene.add(group);
    this.infraGroups.push(group);
    this.infraIndex.set(`${x},${y}`, group);
    this._buildingMeshesDirty = true;
    this.addLightSpot(x, y);
  }

  /** Remove a single infrastructure building from the scene (O(1), no full rebuild). */
  removeInfrastructure(scene: THREE.Scene, x: number, y: number): void {
    const key = `${x},${y}`;
    const group = this.infraIndex.get(key);
    if (!group) return;

    scene.remove(group);
    disposeGroup(group);

    const idx = this.infraGroups.indexOf(group);
    if (idx >= 0) this.infraGroups.splice(idx, 1);
    this.infraIndex.delete(key);
    this._buildingMeshesDirty = true;
    this.removeLightSpot(x, y);
  }

  /** Rebuild only zone overlay meshes (cheap grid scan + InstancedMesh creation). */
  rebuildZoneOverlays(scene: THREE.Scene, grid: Grid, blockerOf?: (x: number, y: number) => ZoneBlocker | null): void {
    for (const mesh of this.overlayMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
    this.overlayMeshes = [];
    this.overlayIndex.clear();

    const emptyZonesByType = new Map<string, { x: number; y: number }[]>();
    grid.forEachCell((cell, x, y) => {
      if (cell.zoneType !== ZoneType.NONE && cell.buildingId === 0) {
        const key = BuildingRenderer.overlayGroupKey(cell.zoneType, blockerOf?.(x, y) ?? null);
        const arr = emptyZonesByType.get(key);
        if (arr) arr.push({ x, y });
        else emptyZonesByType.set(key, [{ x, y }]);
      }
    });

    this.buildZoneOverlays(scene, emptyZonesByType);
  }

  /** Remove a single zone overlay at (x, y) — swap-with-last, O(1). */
  removeZoneOverlay(x: number, y: number): void {
    const key = `${x},${y}`;
    const entry = this.overlayIndex.get(key);
    if (!entry) return;

    const { mesh, idx } = entry;
    const lastIdx = mesh.count - 1;

    if (idx !== lastIdx) {
      // Swap last instance into the removed slot
      mesh.getMatrixAt(lastIdx, this._matrix);
      mesh.setMatrixAt(idx, this._matrix);

      // Update index for the moved instance
      const lastX = this._matrix.elements[12];
      const lastZ = this._matrix.elements[14];
      const lastKey = `${lastX},${lastZ}`;
      const lastEntry = this.overlayIndex.get(lastKey);
      if (lastEntry) lastEntry.idx = idx;
    }

    mesh.count = lastIdx;
    mesh.instanceMatrix.needsUpdate = true;
    this.overlayIndex.delete(key);
  }

  // ─── Full rebuild (init / save load) ───────────────────────────

  build(scene: THREE.Scene, grid: Grid, blockerOf?: (x: number, y: number) => ZoneBlocker | null): void {
    this.initVariantMeshes(scene);
    this.disposeNonPersistent(scene);

    // Reset all variant instance counts (keep GPU buffers alive)
    for (const [key, mesh] of this.variantMeshes) {
      mesh.count = 0;
      this.variantCounts.set(key, 0);
      this.instanceToPosition.get(key)!.clear();
    }
    this.positionToInstance.clear();

    const emptyZonesByType = new Map<string, { x: number; y: number }[]>();
    const infraCells: { x: number; y: number; type: InfraType; reserved: number }[] = [];
    const lightPositions: { x: number; y: number }[] = [];

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.reserved === MULTI_CELL_OCCUPIED) continue;

        const infraCfg = getInfraConfigById(cell.buildingId);
        if (infraCfg) {
          infraCells.push({ x, y, type: infraCfg.type, reserved: cell.reserved });
          lightPositions.push({ x, y });
          continue;
        }

        if (cell.zoneType !== ZoneType.NONE) {
          if (isZoneBuilding(cell.buildingId)) {
            const type = getBuildingType(cell.buildingId);
            const level = type?.level ?? 1;
            const density = type?.density ?? 'LOW';
            const burned = cell.reserved === BURNED;
            const abandoned = cell.reserved === ABANDONED;
            this.addBuilding(x, y, cell.zoneType, density, level, burned, abandoned);
            if (!burned && !abandoned) lightPositions.push({ x, y });
          } else if (cell.buildingId === 0) {
            const key = BuildingRenderer.overlayGroupKey(cell.zoneType, blockerOf?.(x, y) ?? null);
            if (!emptyZonesByType.has(key)) emptyZonesByType.set(key, []);
            emptyZonesByType.get(key)!.push({ x, y });
          }
        }
      }
    }

    // Batch needsUpdate for all variant meshes
    for (const mesh of this.variantMeshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this.buildInfrastructure(scene, infraCells);
    this.buildZoneOverlays(scene, emptyZonesByType);
    this.buildLightSpots(scene, lightPositions);
  }

  private static readonly ZONE_GROUND_COLORS: Record<number, number> = {
    [ZoneType.RESIDENTIAL_LOW]: PALETTE.ZONE.RES_LOW_OVERLAY,
    [ZoneType.RESIDENTIAL_HIGH]: PALETTE.ZONE.RES_HIGH,
    [ZoneType.COMMERCIAL_LOW]: PALETTE.ZONE.COM_LOW_LIGHT,
    [ZoneType.COMMERCIAL_HIGH]: PALETTE.ZONE.COM_HIGH,
    [ZoneType.INDUSTRIAL]: PALETTE.ZONE.IND,
    [ZoneType.OFFICE]: PALETTE.ZONE.OFFICE,
  };

  /**
   * Group key for an empty zoned cell's overlay.
   *
   * A blocked cell is grouped by its BLOCKER rather than its zone, so it gets
   * the blocker's colour instead of the zone's. Without this an empty cell that
   * can never develop is drawn identically to one that is simply waiting its
   * turn — which is how twelve residential cells sat empty through a whole play
   * session with nothing on screen saying their road was on a separate network
   * from the power plant.
   */
  private static overlayGroupKey(zoneType: number, blocker: ZoneBlocker | null): string {
    return blocker && ACTIONABLE_BLOCKERS.has(blocker) ? `b:${blocker}` : `z:${zoneType}`;
  }

  private static overlayGroupStyle(key: string): { color: number; opacity: number } {
    if (key.startsWith('b:')) {
      const blocker = key.slice(2) as ZoneBlocker;
      // Louder than a plain zone tint: this is a call to action, not decoration.
      return { color: ZONE_BLOCKER_COLORS[blocker] ?? 0xff6d00, opacity: 0.6 };
    }
    const zoneType = Number(key.slice(2));
    return { color: BuildingRenderer.ZONE_GROUND_COLORS[zoneType] ?? 0x888888, opacity: 0.35 };
  }

  private buildZoneOverlays(scene: THREE.Scene, emptyZonesByType: Map<string, { x: number; y: number }[]>): void {
    const matrix = new THREE.Matrix4();
    for (const [groupKey, cells] of emptyZonesByType) {
      const { color: baseColor, opacity } = BuildingRenderer.overlayGroupStyle(groupKey);
      const count = Math.min(cells.length, this.maxPerVariant);
      const geometry = new THREE.PlaneGeometry(0.9, 0.9);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        color: baseColor, transparent: true, opacity, depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        const c = cells[i]!;
        matrix.setPosition(c.x, 0.02, c.y);
        mesh.setMatrixAt(i, matrix);
        this.overlayIndex.set(`${c.x},${c.y}`, { mesh, idx: i });
      }
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      this.overlayMeshes.push(mesh);
    }
  }

  // ─── Utility outage icons ──────────────────────────────────────
  //
  // A zoned cell that will not develop can say why. A building that WAS built
  // and then lost its power said nothing at all, and the first thing the player
  // saw was it abandoning itself weeks later, long after the blackout scrolled
  // off screen. These are the missing half: one blinking badge per stopped
  // building, at the cell it stands on.
  //
  // The camera rotates (Q/E) and is orthographic, so every badge shares one
  // orientation — the matrices only need rewriting when that orientation moves,
  // not per frame.

  private warnMeshes: THREE.InstancedMesh[] = [];
  private warnCells: WarnedCell[] = [];
  private warnQuatKey = '';
  private static readonly WARN_HEIGHT = 1.15;
  /**
   * Badge size, as a fraction of the shape geometry.
   *
   * At full size a badge covered most of the cell it belonged to, which made a
   * street of blacked-out houses unreadable — the badges overlapped each other
   * before you could tell which building each one belonged to.
   */
  private static readonly WARN_SCALE = 0.5;
  /** Radius of the dark plate the icon sits on. */
  private static readonly WARN_PLATE_RADIUS = 0.34;
  /**
   * How much of the plate the icon is allowed to fill.
   *
   * The bolt's tips reach a radius of about 0.46 as drawn, against a plate of
   * 0.34, so it stuck out top and bottom and read as a shape with a disc
   * behind it rather than a badge. Fitting is done by measuring the geometry
   * rather than by hand-tuning the path, so editing the shape cannot quietly
   * push it back outside the ring.
   */
  private static readonly WARN_ICON_INSET = 0.66;
  /**
   * Centre-to-centre distance between a building's badges, in grid units.
   *
   * A rendered plate is 2 x WARN_PLATE_RADIUS x WARN_SCALE = 0.34 across, so
   * this leaves a small gap. Badges are laid out along the camera's right
   * vector and centred on the building, so a lone badge sits dead centre and a
   * pair straddles it.
   */
  private static readonly WARN_SPACING = 0.4;

  /** The icon shape, scaled to sit wholly inside the plate. */
  private static warningIconGeometry(warning: UtilityWarning): THREE.ShapeGeometry {
    const geometry = new THREE.ShapeGeometry(BuildingRenderer.warningShape(warning));
    geometry.computeBoundingSphere();
    const drawn = geometry.boundingSphere?.radius ?? 0;
    if (drawn > 0) {
      const target = BuildingRenderer.WARN_PLATE_RADIUS * BuildingRenderer.WARN_ICON_INSET;
      geometry.scale(target / drawn, target / drawn, 1);
      geometry.computeBoundingSphere();
    }
    return geometry;
  }

  /** Icon outlines, drawn as geometry so there is no canvas dependency. */
  private static warningShape(warning: UtilityWarning): THREE.Shape {
    const s = new THREE.Shape();
    if (warning === 'NO_POWER') {
      // A lightning bolt.
      s.moveTo(0.10, 0.45);
      s.lineTo(-0.32, 0.02);
      s.lineTo(-0.04, 0.02);
      s.lineTo(-0.12, -0.45);
      s.lineTo(0.32, 0.04);
      s.lineTo(0.04, 0.04);
    } else {
      // A water drop.
      s.moveTo(0, 0.45);
      s.bezierCurveTo(0.30, 0.05, 0.28, -0.12, 0.18, -0.28);
      s.bezierCurveTo(0.08, -0.44, -0.08, -0.44, -0.18, -0.28);
      s.bezierCurveTo(-0.28, -0.12, -0.30, 0.05, 0, 0.45);
    }
    s.closePath();
    return s;
  }

  /**
   * Replace the set of buildings shown as stopped. Cheap enough to call on the
   * slow cycle: the whole point is that it tracks the utility networks, which
   * only move there.
   */
  setUtilityWarnings(scene: THREE.Scene, warned: WarnedCell[]): void {
    for (const mesh of this.warnMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.warnMeshes = [];
    this.warnCells = warned;
    this.warnQuatKey = '';
    if (warned.length === 0) return;

    const byWarning = new Map<UtilityWarning, WarnedCell[]>();
    for (const w of warned) {
      const arr = byWarning.get(w.warning);
      if (arr) arr.push(w);
      else byWarning.set(w.warning, [w]);
    }

    for (const [warning, cells] of byWarning) {
      const count = Math.min(cells.length, this.maxPerVariant);

      // A dark plate behind the icon, so a yellow bolt still reads against a
      // pale roof at midday.
      const plate = new THREE.InstancedMesh(
        new THREE.CircleGeometry(BuildingRenderer.WARN_PLATE_RADIUS, 24),
        new THREE.MeshBasicMaterial({
          color: 0x101418, transparent: true, opacity: 0.72,
          // A HUD marker, not a thing in the world: it has to be legible from
          // any camera angle, and the building it belongs to is exactly what
          // was hiding it. Tall neighbours occluded the badge on the building
          // that had actually stopped.
          depthWrite: false, depthTest: false,
        }),
        count,
      );
      const icon = new THREE.InstancedMesh(
        BuildingRenderer.warningIconGeometry(warning),
        new THREE.MeshBasicMaterial({
          color: UTILITY_WARNING_COLORS[warning], transparent: true,
          opacity: 1, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
        }),
        count,
      );
      for (const mesh of [plate, icon]) {
        mesh.frustumCulled = false;
        mesh.renderOrder = 999;
        mesh.userData['warnCells'] = cells.slice(0, count);
        mesh.userData['isIcon'] = mesh === icon;
        scene.add(mesh);
        this.warnMeshes.push(mesh);
      }
    }
  }

  /** Face the badges at the camera. Only does work when the camera has moved. */
  private layoutUtilityWarnings(cameraQuaternion: THREE.Quaternion): void {
    const q = cameraQuaternion;
    const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}`;
    if (key === this.warnQuatKey) return;
    this.warnQuatKey = key;

    const s = BuildingRenderer.WARN_SCALE;
    const scale = new THREE.Vector3(s, s, s);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const position = new THREE.Vector3();
    for (const mesh of this.warnMeshes) {
      const cells = mesh.userData['warnCells'] as WarnedCell[];
      // The icon sits a hair in front of its plate along the view direction.
      const lift = mesh.userData['isIcon'] ? 0.01 : 0;
      const forward = new THREE.Vector3(0, 0, lift).applyQuaternion(q);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        // Centred on the building: one badge sits dead centre, two straddle it.
        const slots = c.slotCount ?? 1;
        const nudge = ((c.slot ?? 0) - (slots - 1) / 2) * BuildingRenderer.WARN_SPACING;
        const bx = c.drawX ?? c.x;
        const by = c.drawY ?? c.y;
        position.set(
          bx + forward.x + right.x * nudge,
          BuildingRenderer.WARN_HEIGHT + forward.y + right.y * nudge,
          by + forward.z + right.z * nudge,
        );
        this._matrix.compose(position, q, scale);
        mesh.setMatrixAt(i, this._matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Blink the badges and keep them facing the camera. Called from the render
   * loop, so `dt` is real seconds and the pulse does not change with game speed
   * — a paused city still has to show its blackout.
   */
  updateUtilityWarnings(cameraQuaternion: THREE.Quaternion): void {
    if (this.warnMeshes.length === 0) return;
    this.layoutUtilityWarnings(cameraQuaternion);

    // Roughly one pulse per second, never fading to nothing: a badge that
    // vanishes between beats is one the player can miss entirely.
    const pulse = 0.55 + 0.45 * Math.sin(this._elapsedTime * Math.PI * 2);
    for (const mesh of this.warnMeshes) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = mesh.userData['isIcon'] ? pulse : 0.72 * pulse;
    }
  }

  /** The buildings currently drawn as stopped — for tests and the debug panel. */
  getUtilityWarnings(): readonly WarnedCell[] {
    return this.warnCells;
  }

  private buildInfrastructure(scene: THREE.Scene, cells: { x: number; y: number; type: InfraType; reserved: number }[]): void {
    for (const inf of cells) {
      const cfg = getInfraConfig(inf.type);
      const rotationDeg = RESERVED_TO_ROTATION[inf.reserved] ?? 0;

      // All infra uses top-left placement — convert to center for 3D positioning
      const { w, h } = cfg
        ? getRotatedSize(cfg.width, cfg.height, rotationDeg as Rotation)
        : { w: 1, h: 1 };
      const centerX = inf.x + (w - 1) / 2;
      const centerZ = inf.y + (h - 1) / 2;

      const group = new THREE.Group();
      group.position.set(centerX, 0, centerZ);
      if (rotationDeg !== 0) {
        group.rotation.y = (rotationDeg * Math.PI) / 180;
      }

      this.buildModel(inf.type, group);

      scene.add(group);
      this.infraGroups.push(group);
      this.infraIndex.set(`${inf.x},${inf.y}`, group);
    }
  }

  /**
   * Build a preview model of the given infrastructure type into the provided group.
   * Used by PlacementPreview to show the actual building shape as a ghost.
   * Meshes are NOT tracked in this.meshes so they won't interfere with normal rendering.
   */
  buildPreviewModel(type: InfraType, group: THREE.Group): void {
    this.buildModel(type, group);
  }

  /** Dispatch to the appropriate build method. Always scale=1 since models are pre-sized. */
  private buildModel(type: InfraType, group: THREE.Group): void {
    switch (type) {
      case 'power':     this.buildPowerPlant(group, 0, 0); break;
      case 'water':     this.buildWaterPump(group, 0, 0); break;
      case 'police':    this.buildPoliceStation(group, 0, 0); break;
      case 'fire':      this.buildFireStation(group, 0, 0); break;
      case 'hospital':  this.buildHospital(group, 0, 0); break;
      case 'school':    this.buildElementarySchool(group, 0, 0); break;
      case 'school_high': this.buildHighSchool(group, 0, 0); break;
      case 'school_univ': this.buildUniversity(group, 0, 0); break;
      case 'park':      this.buildPark(group, 0, 0); break;
      case 'cemetery':  this.buildCemetery(group, 0, 0); break;
      case 'garbage':   this.buildLandfill(group, 0, 0); break;
      case 'sewage':    this.buildSewagePlant(group, 0, 0); break;
      case 'bus_stop':  this.buildBusStop(group, 0, 0); break;
      case 'metro_station': this.buildMetroStation(group, 0, 0); break;
      case 'train_station': this.buildTrainStation(group, 0, 0); break;
      case 'ferry_dock':   this.buildFerryDock(group, 0, 0); break;
      case 'airport_s':    this.buildAirportSmall(group, 0, 0); break;
      case 'airport_m':    this.buildAirportMedium(group, 0, 0); break;
      case 'airport_l':    this.buildAirportLarge(group, 0, 0); break;
      default:          this.buildCivicBuilding(group, 0, 0, type); break;
    }
  }

  private buildCivicBuilding(scene: THREE.Scene | THREE.Group, cx: number, cz: number, type: InfraType, scale = 1): void {
    const configs: Record<string, { color: number; height: number; roofColor: number; accent?: number }> = {
      police:      { color: 0x3f51b5, height: 0.40, roofColor: 0x303f9f },
      fire:        { color: 0xd32f2f, height: 0.38, roofColor: 0xb71c1c },
      hospital:    { color: 0xe8e8e8, height: 0.50, roofColor: 0xbbbbbb, accent: 0xe91e63 },
      school:      { color: 0x795548, height: 0.30, roofColor: 0x5d4037 },
      school_high: { color: 0x6d4c41, height: 0.40, roofColor: 0x4e342e },
      school_univ: { color: 0x4e342e, height: 0.55, roofColor: 0x3e2723, accent: 0xffd600 },
      park:        { color: 0x4caf50, height: 0.10, roofColor: 0x388e3c },
      garbage:     { color: 0x795548, height: 0.25, roofColor: 0x5d4037 },
      sewage:      { color: 0x607d8b, height: 0.20, roofColor: 0x455a64 },
      cemetery:    { color: 0x9e9e9e, height: 0.15, roofColor: 0x757575 },
      // Transport stops
      bus_stop:       { color: 0xff9800, height: 0.25, roofColor: 0xf57c00 },
      metro_station:  { color: 0x2196f3, height: 0.30, roofColor: 0x1565c0 },
      train_station:  { color: 0x795548, height: 0.45, roofColor: 0x5d4037, accent: 0xff5722 },
      ferry_dock:     { color: 0x00bcd4, height: 0.18, roofColor: 0x00838f },
      airport:        { color: 0xeceff1, height: 0.55, roofColor: 0x90a4ae, accent: 0x2196f3 },
    };
    const cfg = configs[type] ?? { color: 0x888888, height: 0.35, roofColor: 0x666666 };
    const s = scale; // scale factor for multi-cell buildings
    const bodyW = 0.50 * s;
    const bodyD = 0.50 * s;
    const h = cfg.height * Math.min(s, 2); // height scales but caps at 2x

    // Main building body
    const bodyGeo = new THREE.BoxGeometry(bodyW, h, bodyD);
    bodyGeo.translate(0, h / 2, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color });
    this.addInfraMesh(scene, bodyGeo, bodyMat, cx, 0.05, cz);

    // Roof
    if (type !== 'park') {
      const roofGeo = new THREE.BoxGeometry(bodyW + 0.05 * s, 0.04, bodyD + 0.05 * s);
      roofGeo.translate(0, 0.02, 0);
      const roofMat = new THREE.MeshLambertMaterial({ color: cfg.roofColor });
      this.addInfraMesh(scene, roofGeo, roofMat, cx, h + 0.05, cz);
    }

    // Accent detail (cross for hospital, dome for university, etc.)
    if (cfg.accent && type === 'hospital') {
      const crossH = new THREE.BoxGeometry(0.20 * s, 0.03, 0.06 * s);
      crossH.translate(0, 0.015, 0);
      const crossV = new THREE.BoxGeometry(0.06 * s, 0.03, 0.20 * s);
      crossV.translate(0, 0.015, 0);
      const crossMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, crossH, crossMat, cx, h + 0.09, cz);
      this.addInfraMesh(scene, crossV, crossMat, cx, h + 0.09, cz);
    }
    if (cfg.accent && type === 'school_univ') {
      const domeGeo = new THREE.SphereGeometry(0.12 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, domeGeo, domeMat, cx, h + 0.09, cz);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP A — Emergency Services (Police / Fire / Hospital)
  // ═══════════════════════════════════════════════════════════════════

  private buildPoliceStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Concrete ground / parking lot base
    const groundGeo = new THREE.BoxGeometry(1.70, 0.02, 1.70);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, 0.05, cz, false);

    // L-shaped main building — long wing
    const longWingGeo = new THREE.BoxGeometry(1.20, 0.50, 0.60);
    longWingGeo.translate(-0.10, 0.50 / 2, -0.25);
    const longWingMat = new THREE.MeshLambertMaterial({ color: 0x3f51b5 });
    this.addInfraMesh(scene, longWingGeo, longWingMat, cx, 0.05, cz);

    // L-shaped main building — short wing
    const shortWingGeo = new THREE.BoxGeometry(0.60, 0.50, 0.80);
    shortWingGeo.translate(0.45, 0.50 / 2, 0.15);
    const shortWingMat = new THREE.MeshLambertMaterial({ color: 0x3949a3 });
    this.addInfraMesh(scene, shortWingGeo, shortWingMat, cx, 0.05, cz);

    // Roof for long wing
    const longRoofGeo = new THREE.BoxGeometry(1.28, 0.03, 0.68);
    longRoofGeo.translate(-0.10, 0.015, -0.25);
    const longRoofMat = new THREE.MeshLambertMaterial({ color: 0x303f9f });
    this.addInfraMesh(scene, longRoofGeo, longRoofMat, cx, 0.05 + 0.50, cz);

    // Roof for short wing
    const shortRoofGeo = new THREE.BoxGeometry(0.68, 0.03, 0.88);
    shortRoofGeo.translate(0.45, 0.015, 0.15);
    const shortRoofMat = new THREE.MeshLambertMaterial({ color: 0x303f9f });
    this.addInfraMesh(scene, shortRoofGeo, shortRoofMat, cx, 0.05 + 0.50, cz);

    // Watch tower at corner where wings meet
    const towerGeo = new THREE.BoxGeometry(0.20, 0.45, 0.20);
    towerGeo.translate(0.20, 0.50 + 0.45 / 2, -0.10);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x5c6bc0 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05, cz);

    // Tower cap
    const towerCapGeo = new THREE.BoxGeometry(0.24, 0.02, 0.24);
    towerCapGeo.translate(0.20, 0.50 + 0.45 + 0.01, -0.10);
    const towerCapMat = new THREE.MeshLambertMaterial({ color: 0x283593 });
    this.addInfraMesh(scene, towerCapGeo, towerCapMat, cx, 0.05, cz);

    // 2 garage doors on front of long wing (facing +Z side)
    const garageMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const garage1Geo = new THREE.BoxGeometry(0.28, 0.35, 0.01);
    garage1Geo.translate(-0.30, 0.35 / 2, -0.25 + 0.60 / 2 + 0.005);
    this.addInfraMesh(scene, garage1Geo, garageMat, cx, 0.05, cz);

    const garage2Geo = new THREE.BoxGeometry(0.28, 0.35, 0.01);
    garage2Geo.translate(0.08, 0.35 / 2, -0.25 + 0.60 / 2 + 0.005);
    this.addInfraMesh(scene, garage2Geo, garageMat, cx, 0.05, cz);

    // Blue police light on tower top
    const lightGeo = new THREE.SphereGeometry(0.035, 6, 6);
    lightGeo.translate(0.20, 0.50 + 0.45 + 0.02 + 0.035, -0.10);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x42a5f5 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.05, cz, false);

    // White stripe band on long wing
    const stripeGeo = new THREE.BoxGeometry(1.20, 0.04, 0.61);
    stripeGeo.translate(-0.10, 0.50 / 2, -0.25);
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xe8eaf6 });
    this.addInfraMesh(scene, stripeGeo, stripeMat, cx, 0.05, cz);

    // 2 patrol car boxes on parking area
    const carMat1 = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const car1Geo = new THREE.BoxGeometry(0.14, 0.07, 0.08);
    car1Geo.translate(-0.50, 0.07 / 2, 0.50);
    this.addInfraMesh(scene, car1Geo, carMat1, cx, 0.05, cz);

    const carMat2 = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    const car2Geo = new THREE.BoxGeometry(0.14, 0.07, 0.08);
    car2Geo.translate(-0.25, 0.07 / 2, 0.50);
    this.addInfraMesh(scene, car2Geo, carMat2, cx, 0.05, cz);

    // Flagpole
    const flagpoleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.40, 4);
    flagpoleGeo.translate(-0.70, 0.40 / 2, 0.70);
    const flagpoleMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.addInfraMesh(scene, flagpoleGeo, flagpoleMat, cx, 0.05, cz);
  }

  private buildFireStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Paved ground base
    const groundGeo = new THREE.BoxGeometry(1.70, 0.02, 1.70);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xa0a0a0 }), cx, 0.05, cz, false);

    // Main garage building
    const mainGeo = new THREE.BoxGeometry(1.30, 0.50, 0.80);
    mainGeo.translate(0, 0.50 / 2, 0.10);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0xd32f2f });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Roof
    const roofGeo = new THREE.BoxGeometry(1.38, 0.03, 0.88);
    roofGeo.translate(0, 0.015, 0.10);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xb71c1c });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.50, cz);

    // 4 garage doors evenly spaced on front face (+Z)
    const garageMat = new THREE.MeshLambertMaterial({ color: 0xef9a9a });
    for (let i = 0; i < 4; i++) {
      const doorGeo = new THREE.BoxGeometry(0.25, 0.38, 0.01);
      doorGeo.translate(-0.45 + i * 0.30, 0.38 / 2, 0.10 + 0.80 / 2 + 0.005);
      this.addInfraMesh(scene, doorGeo, garageMat, cx, 0.05, cz);
    }

    // Rear office/dormitory building
    const rearGeo = new THREE.BoxGeometry(0.60, 0.50, 0.35);
    rearGeo.translate(-0.30, 0.50 / 2, -0.50);
    const rearMat = new THREE.MeshLambertMaterial({ color: 0xc62828 });
    this.addInfraMesh(scene, rearGeo, rearMat, cx, 0.05, cz);

    // Rear building roof
    const rearRoofGeo = new THREE.BoxGeometry(0.66, 0.03, 0.40);
    rearRoofGeo.translate(-0.30, 0.015, -0.50);
    this.addInfraMesh(scene, rearRoofGeo, roofMat, cx, 0.05 + 0.50, cz);

    // Drill tower (back-right)
    const towerGeo = new THREE.BoxGeometry(0.25, 0.80, 0.25);
    towerGeo.translate(0.55, 0.80 / 2, -0.50);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xc62828 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05, cz);

    // Tower cap
    const towerCapGeo = new THREE.BoxGeometry(0.30, 0.02, 0.30);
    towerCapGeo.translate(0.55, 0.80 + 0.01, -0.50);
    const towerCapMat = new THREE.MeshLambertMaterial({ color: 0xb71c1c });
    this.addInfraMesh(scene, towerCapGeo, towerCapMat, cx, 0.05, cz);

    // 2 tower windows
    const windowMat = new THREE.MeshLambertMaterial({ color: 0xffcdd2 });
    const win1Geo = new THREE.BoxGeometry(0.10, 0.10, 0.01);
    win1Geo.translate(0.55, 0.60, -0.50 + 0.25 / 2 + 0.005);
    this.addInfraMesh(scene, win1Geo, windowMat, cx, 0.05, cz);

    const win2Geo = new THREE.BoxGeometry(0.10, 0.10, 0.01);
    win2Geo.translate(0.55, 0.40, -0.50 + 0.25 / 2 + 0.005);
    this.addInfraMesh(scene, win2Geo, windowMat, cx, 0.05, cz);

    // Red warning light on roof
    const lightGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8);
    lightGeo.translate(0, 0.50 + 0.03 + 0.015, 0.10);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.05, cz, false);

    // Front driveway area
    const drivewayGeo = new THREE.BoxGeometry(1.40, 0.015, 0.30);
    drivewayGeo.translate(0, 0.008, 0.70);
    this.addInfraMesh(scene, drivewayGeo, new THREE.MeshLambertMaterial({ color: 0x909090 }), cx, 0.05, cz, false);

    // Fire truck parked in front
    const truckGeo = new THREE.BoxGeometry(0.18, 0.08, 0.10);
    truckGeo.translate(0.30, 0.08 / 2, 0.68);
    this.addInfraMesh(scene, truckGeo, new THREE.MeshLambertMaterial({ color: 0xff0000 }), cx, 0.05, cz);

    // Hose reel on side
    const hoseGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8);
    hoseGeo.rotateZ(Math.PI / 2);
    hoseGeo.translate(-1.30 / 2 - 0.005, 0.20, 0.20);
    const hoseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, hoseGeo, hoseMat, cx, 0.05, cz);
  }

  private buildHospital(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Footprint ground (2×3)
    const groundGeo = new THREE.BoxGeometry(1.80, 0.02, 2.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, 0.05, cz, false);
    // Parking lot ground in front
    const parkingGeo = new THREE.BoxGeometry(1.50, 0.015, 0.80);
    parkingGeo.translate(0, 0.008, 0.90);
    this.addInfraMesh(scene, parkingGeo, new THREE.MeshLambertMaterial({ color: 0xa0a0a0 }), cx, 0.05, cz, false);

    // Main wing
    const mainGeo = new THREE.BoxGeometry(1.50, 0.75, 1.00);
    mainGeo.translate(0, 0.75 / 2, 0.10);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0xeceff1 });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Side wing
    const sideGeo = new THREE.BoxGeometry(0.80, 0.60, 0.80);
    sideGeo.translate(-0.30, 0.60 / 2, -0.70);
    const sideMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
    this.addInfraMesh(scene, sideGeo, sideMat, cx, 0.05, cz);

    // Connecting corridor between wings
    const corridorGeo = new THREE.BoxGeometry(0.30, 0.20, 0.40);
    corridorGeo.translate(-0.30, 0.20 / 2, -0.20);
    this.addInfraMesh(scene, corridorGeo, new THREE.MeshLambertMaterial({ color: 0xdce0e2 }), cx, 0.05, cz);

    // Main roof
    const mainRoofGeo = new THREE.BoxGeometry(1.58, 0.03, 1.08);
    mainRoofGeo.translate(0, 0.015, 0.10);
    const mainRoofMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
    this.addInfraMesh(scene, mainRoofGeo, mainRoofMat, cx, 0.05 + 0.75, cz);

    // Side roof
    const sideRoofGeo = new THREE.BoxGeometry(0.88, 0.03, 0.88);
    sideRoofGeo.translate(-0.30, 0.015, -0.70);
    const sideRoofMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    this.addInfraMesh(scene, sideRoofGeo, sideRoofMat, cx, 0.05 + 0.60, cz);

    // Helipad circle on main roof
    const helipadGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.01, 12);
    helipadGeo.translate(0.30, 0.75 + 0.03 + 0.005, 0.10);
    const helipadMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, helipadGeo, helipadMat, cx, 0.05, cz);

    // H marking — horizontal bar
    const hMarkHGeo = new THREE.BoxGeometry(0.14, 0.015, 0.04);
    hMarkHGeo.translate(0.30, 0.75 + 0.03 + 0.015, 0.10);
    const hMarkMat = new THREE.MeshLambertMaterial({ color: 0xe91e63 });
    this.addInfraMesh(scene, hMarkHGeo, hMarkMat, cx, 0.05, cz);

    // H marking — vertical bar left
    const hMarkV1Geo = new THREE.BoxGeometry(0.04, 0.015, 0.14);
    hMarkV1Geo.translate(0.30 - 0.05, 0.75 + 0.03 + 0.015, 0.10);
    this.addInfraMesh(scene, hMarkV1Geo, hMarkMat, cx, 0.05, cz);

    // H marking — vertical bar right
    const hMarkV2Geo = new THREE.BoxGeometry(0.04, 0.015, 0.14);
    hMarkV2Geo.translate(0.30 + 0.05, 0.75 + 0.03 + 0.015, 0.10);
    this.addInfraMesh(scene, hMarkV2Geo, hMarkMat, cx, 0.05, cz);

    // Red cross on front wall — horizontal
    const crossHGeo = new THREE.BoxGeometry(0.22, 0.03, 0.06);
    crossHGeo.translate(0, 0.55, 0.10 + 1.00 / 2 + 0.005);
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xe91e63 });
    this.addInfraMesh(scene, crossHGeo, crossMat, cx, 0.05, cz);

    // Red cross on front wall — vertical
    const crossVGeo = new THREE.BoxGeometry(0.06, 0.03, 0.22);
    crossVGeo.translate(0, 0.55, 0.10 + 1.00 / 2 + 0.005);
    this.addInfraMesh(scene, crossVGeo, crossMat, cx, 0.05, cz);

    // ER canopy protruding from front
    const canopyGeo = new THREE.BoxGeometry(0.60, 0.02, 0.30);
    canopyGeo.translate(0, 0.25 + 0.01, 0.10 + 1.00 / 2 + 0.30 / 2);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05, cz);

    // Canopy pillar left
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const pillar1Geo = new THREE.CylinderGeometry(0.018, 0.018, 0.25, 6);
    pillar1Geo.translate(-0.25, 0.25 / 2, 0.10 + 1.00 / 2 + 0.28);
    this.addInfraMesh(scene, pillar1Geo, pillarMat, cx, 0.05, cz);

    // Canopy pillar right
    const pillar2Geo = new THREE.CylinderGeometry(0.018, 0.018, 0.25, 6);
    pillar2Geo.translate(0.25, 0.25 / 2, 0.10 + 1.00 / 2 + 0.28);
    this.addInfraMesh(scene, pillar2Geo, pillarMat, cx, 0.05, cz);

    // 2 ambulance boxes on parking area
    const ambulanceMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const amb1Geo = new THREE.BoxGeometry(0.14, 0.06, 0.08);
    amb1Geo.translate(-0.30, 0.06 / 2, 0.95);
    this.addInfraMesh(scene, amb1Geo, ambulanceMat, cx, 0.05, cz);

    const amb2Geo = new THREE.BoxGeometry(0.14, 0.06, 0.08);
    amb2Geo.translate(0.10, 0.06 / 2, 0.95);
    this.addInfraMesh(scene, amb2Geo, ambulanceMat, cx, 0.05, cz);

    // Green garden area on one side
    const gardenGeo = new THREE.BoxGeometry(0.60, 0.015, 0.50);
    gardenGeo.translate(0.40, 0.008, -0.85);
    this.addInfraMesh(scene, gardenGeo, new THREE.MeshLambertMaterial({ color: 0x66bb6a }), cx, 0.05, cz, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP B — Education (Elementary / High School / University)
  // ═══════════════════════════════════════════════════════════════════

  private buildElementarySchool(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Footprint ground (2×2)
    const groundGeo = new THREE.BoxGeometry(1.80, 0.02, 1.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, 0.05, cz, false);
    // Low perimeter wall
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xbcaaa4 });
    // Front wall
    const wallFGeo = new THREE.BoxGeometry(1.70, 0.06, 0.03);
    wallFGeo.translate(0, 0.03, 0.84);
    this.addInfraMesh(scene, wallFGeo, wallMat, cx, 0.05, cz);
    // Back wall
    const wallBGeo = new THREE.BoxGeometry(1.70, 0.06, 0.03);
    wallBGeo.translate(0, 0.03, -0.84);
    this.addInfraMesh(scene, wallBGeo, wallMat, cx, 0.05, cz);
    // Left wall
    const wallLGeo = new THREE.BoxGeometry(0.03, 0.06, 1.70);
    wallLGeo.translate(-0.84, 0.03, 0);
    this.addInfraMesh(scene, wallLGeo, wallMat, cx, 0.05, cz);
    // Right wall
    const wallRGeo = new THREE.BoxGeometry(0.03, 0.06, 1.70);
    wallRGeo.translate(0.84, 0.03, 0);
    this.addInfraMesh(scene, wallRGeo, wallMat, cx, 0.05, cz);

    // Main classroom building (1 story, brown)
    const bodyGeo = new THREE.BoxGeometry(1.10, 0.35, 0.65);
    bodyGeo.translate(-0.20, 0.35 / 2, -0.35);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
    this.addInfraMesh(scene, bodyGeo, bodyMat, cx, 0.05, cz);

    // Main roof
    const roofGeo = new THREE.BoxGeometry(1.18, 0.03, 0.72);
    roofGeo.rotateX(0.05);
    roofGeo.translate(-0.20, 0.015, -0.35);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xff7043 });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.35, cz);

    // Second classroom wing parallel to main
    const wing2Geo = new THREE.BoxGeometry(0.80, 0.30, 0.50);
    wing2Geo.translate(-0.30, 0.30 / 2, 0.25);
    const wing2Mat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    this.addInfraMesh(scene, wing2Geo, wing2Mat, cx, 0.05, cz);

    // Second wing roof
    const roof2Geo = new THREE.BoxGeometry(0.88, 0.03, 0.56);
    roof2Geo.rotateX(0.05);
    roof2Geo.translate(-0.30, 0.015, 0.25);
    this.addInfraMesh(scene, roof2Geo, roofMat, cx, 0.05 + 0.30, cz);

    // Entrance porch (protruding from main building front)
    const porchGeo = new THREE.BoxGeometry(0.22, 0.30, 0.12);
    porchGeo.translate(-0.20, 0.30 / 2, -0.35 - 0.65 / 2 - 0.12 / 2);
    const porchMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    this.addInfraMesh(scene, porchGeo, porchMat, cx, 0.05, cz);

    // Porch roof
    const porchRoofGeo = new THREE.BoxGeometry(0.28, 0.02, 0.16);
    porchRoofGeo.translate(-0.20, 0.01, -0.35 - 0.65 / 2 - 0.12 / 2);
    const porchRoofMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, porchRoofGeo, porchRoofMat, cx, 0.05 + 0.30, cz);

    // Playground ground (right side)
    const playGeo = new THREE.BoxGeometry(0.80, 0.01, 0.80);
    playGeo.translate(0.40, 0.005, 0.30);
    const playMat = new THREE.MeshLambertMaterial({ color: 0xa5d6a7 });
    this.addInfraMesh(scene, playGeo, playMat, cx, 0.05, cz, false);

    // Swing frame
    const swingGeo = new THREE.BoxGeometry(0.14, 0.20, 0.03);
    swingGeo.translate(0.25, 0.20 / 2, 0.20);
    const swingMat = new THREE.MeshLambertMaterial({ color: 0xff8a65 });
    this.addInfraMesh(scene, swingGeo, swingMat, cx, 0.05, cz);

    // Slide (yellow, tilted)
    const slideGeo = new THREE.BoxGeometry(0.08, 0.18, 0.03);
    slideGeo.rotateX(-0.4);
    slideGeo.translate(0.55, 0.18 / 2, 0.35);
    const slideMat = new THREE.MeshLambertMaterial({ color: 0xffd54f });
    this.addInfraMesh(scene, slideGeo, slideMat, cx, 0.05, cz);

    // Tree trunk
    const trunkGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.15, 5);
    trunkGeo.translate(-0.65, 0.15 / 2, 0.55);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
    this.addInfraMesh(scene, trunkGeo, trunkMat, cx, 0.05, cz);

    // Tree canopy
    const canopyGeo = new THREE.SphereGeometry(0.10, 6, 5);
    canopyGeo.translate(-0.65, 0.15 + 0.06, 0.55);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05, cz);

    // Flagpole
    const flagGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.35, 4);
    flagGeo.translate(0.70, 0.35 / 2, -0.70);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, flagGeo, flagMat, cx, 0.05, cz);
  }

  private buildHighSchool(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Footprint ground (2×3)
    const groundGeo = new THREE.BoxGeometry(1.80, 0.02, 2.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, 0.05, cz, false);
    // Entrance plaza (paved)
    const plazaGeo = new THREE.BoxGeometry(0.60, 0.015, 0.30);
    plazaGeo.translate(0, 0.008, -1.15);
    this.addInfraMesh(scene, plazaGeo, new THREE.MeshLambertMaterial({ color: 0xbcaaa4 }), cx, 0.05, cz, false);

    // Main teaching block (2 stories)
    const mainGeo = new THREE.BoxGeometry(1.40, 0.60, 0.70);
    mainGeo.translate(0, 0.60 / 2, -0.60);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Main roof
    const roofGeo = new THREE.BoxGeometry(1.48, 0.03, 0.78);
    roofGeo.translate(0, 0.015, -0.60);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.60, cz);

    // Clock tower (center, sitting on roof)
    const towerGeo = new THREE.BoxGeometry(0.20, 0.40, 0.20);
    towerGeo.translate(0, 0.40 / 2, -0.60);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05 + 0.60 + 0.03, cz);

    // Tower spire
    const spireGeo = new THREE.ConeGeometry(0.14, 0.12, 4);
    spireGeo.translate(0, 0.12 / 2, -0.60);
    const spireMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, spireGeo, spireMat, cx, 0.05 + 0.60 + 0.03 + 0.40, cz);

    // Clock face (on tower front, facing -Z)
    const clockGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8);
    clockGeo.rotateX(Math.PI / 2);
    clockGeo.translate(0, 0.25, -0.60 - 0.101);
    const clockMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, clockGeo, clockMat, cx, 0.05 + 0.60 + 0.03, cz, false);

    // Gymnasium building
    const gymGeo = new THREE.BoxGeometry(0.70, 0.60, 0.45);
    gymGeo.translate(-0.30, 0.60 / 2, 0.25);
    const gymMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
    this.addInfraMesh(scene, gymGeo, gymMat, cx, 0.05, cz);

    // Gymnasium flat roof
    const gymRoofGeo = new THREE.BoxGeometry(0.76, 0.03, 0.50);
    gymRoofGeo.translate(-0.30, 0.015, 0.25);
    this.addInfraMesh(scene, gymRoofGeo, roofMat, cx, 0.05 + 0.60, cz);

    // 3 entrance columns (spaced on front, facing -Z)
    const colMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    for (let i = -1; i <= 1; i++) {
      const colGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6);
      colGeo.translate(i * 0.16, 0.35 / 2, -0.60 - 0.70 / 2 - 0.03);
      this.addInfraMesh(scene, colGeo, colMat, cx, 0.05, cz);
    }

    // Entrance canopy
    const canopyGeo = new THREE.BoxGeometry(0.50, 0.02, 0.14);
    canopyGeo.translate(0, 0.01, -0.60 - 0.70 / 2 - 0.03);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05 + 0.35, cz);

    // Track/sports field
    const trackGeo = new THREE.BoxGeometry(1.00, 0.01, 1.20);
    trackGeo.translate(0.30, 0.005, 0.55);
    const trackMat = new THREE.MeshLambertMaterial({ color: 0xc8b896 });
    this.addInfraMesh(scene, trackGeo, trackMat, cx, 0.05, cz, false);

    // Track white line
    const lineGeo = new THREE.BoxGeometry(0.90, 0.012, 0.01);
    lineGeo.translate(0.30, 0.012, 0.10);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, lineGeo, lineMat, cx, 0.05, cz, false);

    // Flagpole
    const flagGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.45, 4);
    flagGeo.translate(-0.75, 0.45 / 2, -1.10);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, flagGeo, flagMat, cx, 0.05, cz);
  }

  private buildUniversity(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Footprint ground (3×3)
    const groundGeo = new THREE.BoxGeometry(2.80, 0.02, 2.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, 0.05, cz, false);
    // Low perimeter wall/fence
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    const fFGeo = new THREE.BoxGeometry(2.70, 0.06, 0.03);
    fFGeo.translate(0, 0.03, 1.34);
    this.addInfraMesh(scene, fFGeo, fenceMat, cx, 0.05, cz);
    const fBGeo = new THREE.BoxGeometry(2.70, 0.06, 0.03);
    fBGeo.translate(0, 0.03, -1.34);
    this.addInfraMesh(scene, fBGeo, fenceMat, cx, 0.05, cz);
    const fLGeo = new THREE.BoxGeometry(0.03, 0.06, 2.70);
    fLGeo.translate(-1.34, 0.03, 0);
    this.addInfraMesh(scene, fLGeo, fenceMat, cx, 0.05, cz);
    const fRGeo = new THREE.BoxGeometry(0.03, 0.06, 2.70);
    fRGeo.translate(1.34, 0.03, 0);
    this.addInfraMesh(scene, fRGeo, fenceMat, cx, 0.05, cz);

    // Central main hall
    const hallGeo = new THREE.BoxGeometry(1.00, 0.75, 1.00);
    hallGeo.translate(0, 0.75 / 2, 0);
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, hallGeo, hallMat, cx, 0.05, cz);

    // Left wing
    const lwGeo = new THREE.BoxGeometry(0.70, 0.60, 0.70);
    lwGeo.translate(-0.85, 0.60 / 2, 0);
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, lwGeo, wingMat, cx, 0.05, cz);

    // Right wing
    const rwGeo = new THREE.BoxGeometry(0.70, 0.60, 0.70);
    rwGeo.translate(0.85, 0.60 / 2, 0);
    this.addInfraMesh(scene, rwGeo, wingMat, cx, 0.05, cz);

    // Rear library building
    const libGeo = new THREE.BoxGeometry(0.80, 0.60, 0.55);
    libGeo.translate(0, 0.60 / 2, 0.78);
    const libMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, libGeo, libMat, cx, 0.05, cz);

    // Library roof
    const libRoofGeo = new THREE.BoxGeometry(0.88, 0.03, 0.62);
    libRoofGeo.translate(0, 0.015, 0.78);
    const darkRoofMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
    this.addInfraMesh(scene, libRoofGeo, darkRoofMat, cx, 0.05 + 0.60, cz);

    // Main roof
    const mainRoofGeo = new THREE.BoxGeometry(1.08, 0.03, 1.08);
    mainRoofGeo.translate(0, 0.015, 0);
    this.addInfraMesh(scene, mainRoofGeo, darkRoofMat, cx, 0.05 + 0.75, cz);

    // Gold dome (half sphere)
    const domeGeo = new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshLambertMaterial({ color: 0xffd600 });
    this.addInfraMesh(scene, domeGeo, domeMat, cx, 0.05 + 0.75 + 0.03, cz);

    // Dome base ring
    const ringGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.05, 12);
    ringGeo.translate(0, 0.025, 0);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xf9a825 });
    this.addInfraMesh(scene, ringGeo, ringMat, cx, 0.05 + 0.75, cz);

    // 6 front columns
    const colMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    for (let i = 0; i < 6; i++) {
      const colGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6);
      colGeo.translate(-0.30 + i * 0.12, 0.45 / 2, -1.00 / 2 - 0.06);
      this.addInfraMesh(scene, colGeo, colMat, cx, 0.05, cz);
    }

    // Colonnade top
    const colTopGeo = new THREE.BoxGeometry(0.75, 0.04, 0.16);
    colTopGeo.translate(0, 0.02, -1.00 / 2 - 0.06);
    const colTopMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, colTopGeo, colTopMat, cx, 0.05 + 0.45, cz);

    // Pediment (flat triangle facing front)
    const pedGeo = new THREE.ConeGeometry(0.40, 0.12, 3);
    pedGeo.rotateX(Math.PI / 2);
    pedGeo.rotateY(Math.PI / 2);
    pedGeo.translate(0, 0.06, -1.00 / 2 - 0.06);
    const pedMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
    this.addInfraMesh(scene, pedGeo, pedMat, cx, 0.05 + 0.45 + 0.04, cz);

    // Courtyard ground (in front)
    const courtGeo = new THREE.BoxGeometry(1.00, 0.01, 1.00);
    courtGeo.translate(0, 0.005, -0.80);
    const courtMat = new THREE.MeshLambertMaterial({ color: 0xa5d6a7 });
    this.addInfraMesh(scene, courtGeo, courtMat, cx, 0.05, cz, false);

    // Fountain pool
    const fountGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10);
    fountGeo.translate(0, 0.04 / 2, -0.80);
    const fountMat = new THREE.MeshLambertMaterial({ color: 0x90caf9 });
    this.addInfraMesh(scene, fountGeo, fountMat, cx, 0.05, cz);

    // Left wing roof
    const lwRoofGeo = new THREE.BoxGeometry(0.78, 0.03, 0.78);
    lwRoofGeo.translate(-0.85, 0.015, 0);
    this.addInfraMesh(scene, lwRoofGeo, darkRoofMat, cx, 0.05 + 0.60, cz);

    // Right wing roof
    const rwRoofGeo = new THREE.BoxGeometry(0.78, 0.03, 0.78);
    rwRoofGeo.translate(0.85, 0.015, 0);
    this.addInfraMesh(scene, rwRoofGeo, darkRoofMat, cx, 0.05 + 0.60, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP C — Environment (Park / Cemetery / Landfill)
  // ═══════════════════════════════════════════════════════════════════

  private buildPark(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Grass base
    const baseGeo = new THREE.BoxGeometry(0.85, 0.02, 0.85);
    baseGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, baseGeo, new THREE.MeshLambertMaterial({ color: 0x4caf50 }), cx, 0.05, cz, false);

    // Big tree trunk (offset to back-left)
    const bigTrunkGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.20, 5);
    bigTrunkGeo.translate(-0.22, 0.10, -0.20);
    this.addInfraMesh(scene, bigTrunkGeo, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, 0.06, cz);

    // Big tree canopy
    const bigCanopyGeo = new THREE.SphereGeometry(0.16, 6, 5);
    bigCanopyGeo.translate(-0.22, 0.28, -0.20);
    this.addInfraMesh(scene, bigCanopyGeo, new THREE.MeshLambertMaterial({ color: 0x388e3c }), cx, 0.06, cz);

    // Small tree trunk (offset to front-right)
    const smallTrunkGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.14, 5);
    smallTrunkGeo.translate(0.25, 0.07, 0.22);
    this.addInfraMesh(scene, smallTrunkGeo, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Small tree canopy
    const smallCanopyGeo = new THREE.SphereGeometry(0.10, 6, 4);
    smallCanopyGeo.translate(0.25, 0.20, 0.22);
    this.addInfraMesh(scene, smallCanopyGeo, new THREE.MeshLambertMaterial({ color: 0x66bb6a }), cx, 0.06, cz);

    // Fountain pool (center)
    const poolGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.03, 10);
    poolGeo.translate(0.02, 0.015, 0.0);
    this.addInfraMesh(scene, poolGeo, new THREE.MeshLambertMaterial({ color: 0x78909c }), cx, 0.06, cz);

    // Fountain water surface
    const waterGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.01, 10);
    waterGeo.translate(0.02, 0.035, 0.0);
    this.addInfraMesh(scene, waterGeo, new THREE.MeshLambertMaterial({ color: 0x4fc3f7 }), cx, 0.06, cz, false);

    // Water jet (glowing)
    const jetGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.08, 4);
    jetGeo.translate(0.02, 0.075, 0.0);
    this.addInfraMesh(scene, jetGeo, new THREE.MeshBasicMaterial({ color: 0xb3e5fc }), cx, 0.06, cz, false);

    // Bench (front-left area)
    const benchGeo = new THREE.BoxGeometry(0.12, 0.03, 0.04);
    benchGeo.translate(-0.10, 0.015, 0.28);
    this.addInfraMesh(scene, benchGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.06, cz);

    // Second bench (opposite side)
    const bench2Geo = new THREE.BoxGeometry(0.12, 0.03, 0.04);
    bench2Geo.translate(0.18, 0.015, -0.28);
    this.addInfraMesh(scene, bench2Geo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.06, cz);

    // Walking path (diagonal across park)
    const pathGeo = new THREE.BoxGeometry(0.10, 0.012, 0.50);
    pathGeo.rotateY(Math.PI / 4);
    pathGeo.translate(0.0, 0.006, 0.0);
    this.addInfraMesh(scene, pathGeo, new THREE.MeshLambertMaterial({ color: 0xd7ccc8 }), cx, 0.06, cz, false);

    // Small flower bed
    const flowerGeo = new THREE.BoxGeometry(0.10, 0.08, 0.05);
    flowerGeo.translate(0.30, 0.04, -0.10);
    this.addInfraMesh(scene, flowerGeo, new THREE.MeshLambertMaterial({ color: 0xe91e63 }), cx, 0.06, cz);
  }

  private buildCemetery(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Ground (grass)
    const groundGeo = new THREE.BoxGeometry(1.70, 0.02, 1.70);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0x8bc34a }), cx, 0.05, cz, false);

    // Low stone perimeter wall
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    const wFGeo = new THREE.BoxGeometry(1.70, 0.08, 0.04);
    wFGeo.translate(0, 0.04, 0.83);
    this.addInfraMesh(scene, wFGeo, wallMat, cx, 0.05, cz);
    const wBGeo = new THREE.BoxGeometry(1.70, 0.08, 0.04);
    wBGeo.translate(0, 0.04, -0.83);
    this.addInfraMesh(scene, wBGeo, wallMat, cx, 0.05, cz);
    const wLGeo = new THREE.BoxGeometry(0.04, 0.08, 1.70);
    wLGeo.translate(-0.83, 0.04, 0);
    this.addInfraMesh(scene, wLGeo, wallMat, cx, 0.05, cz);
    const wRGeo = new THREE.BoxGeometry(0.04, 0.08, 1.70);
    wRGeo.translate(0.83, 0.04, 0);
    this.addInfraMesh(scene, wRGeo, wallMat, cx, 0.05, cz);

    // Chapel body (back-left corner)
    const chapelGeo = new THREE.BoxGeometry(0.35, 0.35, 0.28);
    chapelGeo.translate(-0.50, 0.175, -0.55);
    this.addInfraMesh(scene, chapelGeo, new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }), cx, 0.06, cz);

    // Chapel spire
    const spireGeo = new THREE.ConeGeometry(0.20, 0.25, 4);
    spireGeo.translate(-0.50, 0.475, -0.55);
    this.addInfraMesh(scene, spireGeo, new THREE.MeshLambertMaterial({ color: 0x757575 }), cx, 0.06, cz);

    // Cross vertical on spire
    const crossVGeo = new THREE.BoxGeometry(0.03, 0.12, 0.015);
    crossVGeo.translate(-0.50, 0.66, -0.55);
    this.addInfraMesh(scene, crossVGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Cross horizontal on spire
    const crossHGeo = new THREE.BoxGeometry(0.08, 0.015, 0.015);
    crossHGeo.translate(-0.50, 0.64, -0.55);
    this.addInfraMesh(scene, crossHGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Gravestones — 4 rows x 5 columns, spread across 1.20 x 1.00 area
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });
    const gsStartX = -0.10;
    const gsStartZ = -0.35;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        const stoneGeo = new THREE.BoxGeometry(0.05, 0.08, 0.02);
        stoneGeo.translate(gsStartX + col * 0.25, 0.04, gsStartZ + row * 0.30);
        this.addInfraMesh(scene, stoneGeo, stoneMat, cx, 0.06, cz);
      }
    }

    // Cypress tree 1 (near chapel)
    const cypTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    const cypTreeMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });

    const cypTrunk1 = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4);
    cypTrunk1.translate(-0.25, 0.03, -0.65);
    this.addInfraMesh(scene, cypTrunk1, cypTrunkMat, cx, 0.06, cz);
    const cypTree1 = new THREE.ConeGeometry(0.05, 0.30, 6);
    cypTree1.translate(-0.25, 0.21, -0.65);
    this.addInfraMesh(scene, cypTree1, cypTreeMat, cx, 0.06, cz);

    // Cypress tree 2 (opposite back)
    const cypTrunk2 = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4);
    cypTrunk2.translate(0.60, 0.03, -0.65);
    this.addInfraMesh(scene, cypTrunk2, cypTrunkMat, cx, 0.06, cz);
    const cypTree2 = new THREE.ConeGeometry(0.05, 0.30, 6);
    cypTree2.translate(0.60, 0.21, -0.65);
    this.addInfraMesh(scene, cypTree2, cypTreeMat, cx, 0.06, cz);

    // Cypress tree 3 (front-left)
    const cypTrunk3 = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4);
    cypTrunk3.translate(-0.65, 0.03, 0.55);
    this.addInfraMesh(scene, cypTrunk3, cypTrunkMat, cx, 0.06, cz);
    const cypTree3 = new THREE.ConeGeometry(0.05, 0.30, 6);
    cypTree3.translate(-0.65, 0.21, 0.55);
    this.addInfraMesh(scene, cypTree3, cypTreeMat, cx, 0.06, cz);

    // Cypress tree 4 (front-right)
    const cypTrunk4 = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4);
    cypTrunk4.translate(0.65, 0.03, 0.55);
    this.addInfraMesh(scene, cypTrunk4, cypTrunkMat, cx, 0.06, cz);
    const cypTree4 = new THREE.ConeGeometry(0.05, 0.30, 6);
    cypTree4.translate(0.65, 0.21, 0.55);
    this.addInfraMesh(scene, cypTree4, cypTreeMat, cx, 0.06, cz);

    // Stone path down center
    const pathGeo = new THREE.BoxGeometry(0.18, 0.012, 1.40);
    pathGeo.translate(0.0, 0.006, 0.05);
    this.addInfraMesh(scene, pathGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz, false);

    // Iron gate at entrance (front)
    const gateGeo = new THREE.BoxGeometry(0.30, 0.18, 0.015);
    gateGeo.translate(0.0, 0.09, 0.82);
    this.addInfraMesh(scene, gateGeo, new THREE.MeshLambertMaterial({ color: 0x616161 }), cx, 0.06, cz);
  }

  private buildLandfill(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    // Dirt ground
    const groundGeo = new THREE.BoxGeometry(1.70, 0.02, 1.70);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.05, cz, false);

    // Large garbage mound (center-back)
    const largeMound = new THREE.ConeGeometry(0.35, 0.40, 6);
    largeMound.translate(-0.10, 0.20, -0.20);
    this.addInfraMesh(scene, largeMound, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, 0.06, cz);

    // Medium mound (right)
    const medMound = new THREE.ConeGeometry(0.25, 0.28, 5);
    medMound.translate(0.40, 0.14, 0.10);
    this.addInfraMesh(scene, medMound, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Small mound (left-front)
    const smallMound = new THREE.ConeGeometry(0.18, 0.20, 5);
    smallMound.translate(-0.45, 0.10, 0.30);
    this.addInfraMesh(scene, smallMound, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.06, cz);

    // Extra small mound 1
    const xsMound1 = new THREE.ConeGeometry(0.12, 0.14, 5);
    xsMound1.translate(0.10, 0.07, 0.45);
    this.addInfraMesh(scene, xsMound1, new THREE.MeshLambertMaterial({ color: 0x7b5b4a }), cx, 0.06, cz);

    // Extra small mound 2
    const xsMound2 = new THREE.ConeGeometry(0.10, 0.12, 5);
    xsMound2.translate(-0.35, 0.06, -0.50);
    this.addInfraMesh(scene, xsMound2, new THREE.MeshLambertMaterial({ color: 0x6d5040 }), cx, 0.06, cz);

    // Office shack (back-right corner)
    const shackGeo = new THREE.BoxGeometry(0.30, 0.25, 0.25);
    shackGeo.translate(0.55, 0.125, -0.55);
    this.addInfraMesh(scene, shackGeo, new THREE.MeshLambertMaterial({ color: 0xa1887f }), cx, 0.06, cz);

    // Shack roof
    const shackRoof = new THREE.BoxGeometry(0.35, 0.02, 0.30);
    shackRoof.translate(0.55, 0.26, -0.55);
    this.addInfraMesh(scene, shackRoof, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Bulldozer body (front-left area)
    const dozerBody = new THREE.BoxGeometry(0.20, 0.12, 0.10);
    dozerBody.translate(-0.50, 0.06, 0.55);
    this.addInfraMesh(scene, dozerBody, new THREE.MeshLambertMaterial({ color: 0xffc107 }), cx, 0.06, cz);

    // Bulldozer blade
    const dozerBlade = new THREE.BoxGeometry(0.16, 0.10, 0.03);
    dozerBlade.translate(-0.50, 0.05, 0.48);
    this.addInfraMesh(scene, dozerBlade, new THREE.MeshLambertMaterial({ color: 0xff8f00 }), cx, 0.06, cz);

    // Fences on all 4 sides (3 sides + gate opening on front)
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    // Fence back
    const fenceBack = new THREE.BoxGeometry(1.70, 0.10, 0.015);
    fenceBack.translate(0, 0.05, -0.84);
    this.addInfraMesh(scene, fenceBack, fenceMat, cx, 0.06, cz);
    // Fence left
    const fenceLeft = new THREE.BoxGeometry(0.015, 0.10, 1.70);
    fenceLeft.translate(-0.84, 0.05, 0);
    this.addInfraMesh(scene, fenceLeft, fenceMat, cx, 0.06, cz);
    // Fence right
    const fenceRight = new THREE.BoxGeometry(0.015, 0.10, 1.70);
    fenceRight.translate(0.84, 0.05, 0);
    this.addInfraMesh(scene, fenceRight, fenceMat, cx, 0.06, cz);
    // Fence front left part (gate opening in center)
    const fenceFL = new THREE.BoxGeometry(0.60, 0.10, 0.015);
    fenceFL.translate(-0.55, 0.05, 0.84);
    this.addInfraMesh(scene, fenceFL, fenceMat, cx, 0.06, cz);
    // Fence front right part
    const fenceFR = new THREE.BoxGeometry(0.60, 0.10, 0.015);
    fenceFR.translate(0.55, 0.05, 0.84);
    this.addInfraMesh(scene, fenceFR, fenceMat, cx, 0.06, cz);

    // Warning sign (scaled up)
    const signGeo = new THREE.BoxGeometry(0.10, 0.10, 0.015);
    signGeo.translate(0.0, 0.15, 0.84);
    this.addInfraMesh(scene, signGeo, new THREE.MeshLambertMaterial({ color: 0xf0c030 }), cx, 0.06, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP D — Utility Infrastructure (Sewage / Power / Water)
  // ═══════════════════════════════════════════════════════════════════

  private buildSewagePlant(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {

    // Concrete foundation
    const foundGeo = new THREE.BoxGeometry(1.70, 0.04, 1.70);
    foundGeo.translate(0, 0.02, 0);
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, foundGeo, foundMat, cx, 0.05, cz);

    // Perimeter fence
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const sfF = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    sfF.translate(0, 0.04, 0.84);
    this.addInfraMesh(scene, sfF, fenceMat, cx, 0.05, cz);
    const sfB = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    sfB.translate(0, 0.04, -0.84);
    this.addInfraMesh(scene, sfB, fenceMat, cx, 0.05, cz);
    const sfL = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    sfL.translate(-0.84, 0.04, 0);
    this.addInfraMesh(scene, sfL, fenceMat, cx, 0.05, cz);
    const sfR = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    sfR.translate(0.84, 0.04, 0);
    this.addInfraMesh(scene, sfR, fenceMat, cx, 0.05, cz);

    // Large settling tank (left area)
    const lgTankGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.15, 12);
    lgTankGeo.translate(-0.30, 0.075, -0.25);
    const lgTankMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, lgTankGeo, lgTankMat, cx, 0.09, cz);

    // Large tank water surface
    const lgWaterGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.01, 12);
    lgWaterGeo.translate(-0.30, 0.15, -0.25);
    const lgWaterMat = new THREE.MeshLambertMaterial({ color: 0x80cbc4 });
    this.addInfraMesh(scene, lgWaterGeo, lgWaterMat, cx, 0.09, cz);

    // Walkway bridge across large tank
    const walkGeo = new THREE.BoxGeometry(0.80, 0.02, 0.04);
    walkGeo.translate(-0.30, 0.16, -0.25);
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    this.addInfraMesh(scene, walkGeo, walkMat, cx, 0.09, cz);

    // Small settling tank (right area)
    const smTankGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.12, 10);
    smTankGeo.translate(0.40, 0.06, -0.30);
    const smTankMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, smTankGeo, smTankMat, cx, 0.09, cz);

    // Small tank water surface
    const smWaterGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.01, 10);
    smWaterGeo.translate(0.40, 0.12, -0.30);
    const smWaterMat = new THREE.MeshLambertMaterial({ color: 0x80cbc4 });
    this.addInfraMesh(scene, smWaterGeo, smWaterMat, cx, 0.09, cz);

    // Third aeration tank (front-left)
    const aerTankGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.10, 10);
    aerTankGeo.translate(-0.50, 0.05, 0.40);
    const aerTankMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, aerTankGeo, aerTankMat, cx, 0.09, cz);

    // Aeration tank water
    const aerWaterGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.01, 10);
    aerWaterGeo.translate(-0.50, 0.10, 0.40);
    this.addInfraMesh(scene, aerWaterGeo, lgWaterMat, cx, 0.09, cz);

    // Control building
    const ctrlGeo = new THREE.BoxGeometry(0.40, 0.35, 0.35);
    ctrlGeo.translate(0.45, 0.175, 0.45);
    const ctrlMat = new THREE.MeshLambertMaterial({ color: 0x607d8b });
    this.addInfraMesh(scene, ctrlGeo, ctrlMat, cx, 0.09, cz);

    // Control building roof
    const ctrlRoofGeo = new THREE.BoxGeometry(0.45, 0.02, 0.40);
    ctrlRoofGeo.translate(0.45, 0.36, 0.45);
    const ctrlRoofMat = new THREE.MeshLambertMaterial({ color: 0x455a64 });
    this.addInfraMesh(scene, ctrlRoofGeo, ctrlRoofMat, cx, 0.09, cz);

    // Connecting pipe between large and small tanks
    const pipeGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.35, 6);
    pipeGeo.rotateZ(Math.PI / 2);
    pipeGeo.translate(0.05, 0.10, -0.28);
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, pipeGeo, pipeMat, cx, 0.09, cz);

    // Outlet pipe
    const outletGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.30, 6);
    outletGeo.rotateX(Math.PI / 2);
    outletGeo.translate(-0.30, 0.10, 0.10);
    const outletMat = new THREE.MeshLambertMaterial({ color: 0x607d8b });
    this.addInfraMesh(scene, outletGeo, outletMat, cx, 0.09, cz);

    // Status indicator light
    const lightGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    lightGeo.translate(0.45, 0.40, 0.45);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x26a69a });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.09, cz, false);
  }

  private buildPowerPlant(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {

    // Concrete ground
    const groundGeo = new THREE.BoxGeometry(1.70, 0.03, 1.70);
    groundGeo.translate(0, 0.015, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0x909090 }), cx, 0.05, cz, false);

    // Perimeter fence
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    const pfF = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    pfF.translate(0, 0.04, 0.84);
    this.addInfraMesh(scene, pfF, fenceMat, cx, 0.05, cz);
    const pfB = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    pfB.translate(0, 0.04, -0.84);
    this.addInfraMesh(scene, pfB, fenceMat, cx, 0.05, cz);
    const pfL = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    pfL.translate(-0.84, 0.04, 0);
    this.addInfraMesh(scene, pfL, fenceMat, cx, 0.05, cz);
    const pfR = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    pfR.translate(0.84, 0.04, 0);
    this.addInfraMesh(scene, pfR, fenceMat, cx, 0.05, cz);

    // Main turbine hall
    const hallGeo = new THREE.BoxGeometry(0.85, 0.60, 0.80);
    hallGeo.translate(0.15, 0.30, 0.20);
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x5a5550 });
    this.addInfraMesh(scene, hallGeo, hallMat, cx, 0.08, cz);

    // Hall roof
    const hallRoofGeo = new THREE.BoxGeometry(0.92, 0.03, 0.88);
    hallRoofGeo.translate(0.15, 0.615, 0.20);
    const hallRoofMat = new THREE.MeshLambertMaterial({ color: 0x484440 });
    this.addInfraMesh(scene, hallRoofGeo, hallRoofMat, cx, 0.08, cz);

    // Large cooling tower
    const lgCoolGeo = new THREE.CylinderGeometry(0.20, 0.28, 0.85, 10);
    lgCoolGeo.translate(-0.45, 0.425, -0.30);
    const lgCoolMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, lgCoolGeo, lgCoolMat, cx, 0.08, cz);

    // Cooling tower top ring
    const lgRingGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10);
    lgRingGeo.translate(-0.45, 0.87, -0.30);
    const lgRingMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });
    this.addInfraMesh(scene, lgRingGeo, lgRingMat, cx, 0.08, cz);

    // Small cooling tower
    const smCoolGeo = new THREE.CylinderGeometry(0.14, 0.20, 0.65, 10);
    smCoolGeo.translate(-0.10, 0.325, -0.50);
    const smCoolMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
    this.addInfraMesh(scene, smCoolGeo, smCoolMat, cx, 0.08, cz);

    // Smokestack
    const stackGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.95, 8);
    stackGeo.translate(0.55, 0.475, -0.40);
    const stackMat = new THREE.MeshLambertMaterial({ color: 0x757575 });
    this.addInfraMesh(scene, stackGeo, stackMat, cx, 0.08, cz);

    // Chimney red band 1 (near top)
    const band1Geo = new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8);
    band1Geo.translate(0.55, 0.91, -0.40);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    this.addInfraMesh(scene, band1Geo, bandMat, cx, 0.08, cz);

    // Chimney red band 2 (mid area)
    const band2Geo = new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8);
    band2Geo.translate(0.55, 0.60, -0.40);
    this.addInfraMesh(scene, band2Geo, bandMat, cx, 0.08, cz);

    // Coal pile 1
    const coal1Geo = new THREE.ConeGeometry(0.20, 0.14, 6);
    coal1Geo.translate(-0.40, 0.07, 0.55);
    const coalMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
    this.addInfraMesh(scene, coal1Geo, coalMat, cx, 0.08, cz);

    // Coal pile 2
    const coal2Geo = new THREE.ConeGeometry(0.14, 0.10, 5);
    coal2Geo.translate(-0.12, 0.05, 0.60);
    this.addInfraMesh(scene, coal2Geo, coalMat, cx, 0.08, cz);

    // Transformer box 1
    const tx1Geo = new THREE.BoxGeometry(0.10, 0.15, 0.10);
    tx1Geo.translate(0.65, 0.075, 0.35);
    const txMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, tx1Geo, txMat, cx, 0.08, cz);

    // Transformer box 2
    const tx2Geo = new THREE.BoxGeometry(0.10, 0.15, 0.10);
    tx2Geo.translate(0.65, 0.075, 0.55);
    this.addInfraMesh(scene, tx2Geo, txMat, cx, 0.08, cz);

    // Power pylon
    const pylonGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4);
    pylonGeo.translate(0.70, 0.225, -0.15);
    const pylonMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.addInfraMesh(scene, pylonGeo, pylonMat, cx, 0.08, cz);

    // Pylon crossarm
    const crossGeo = new THREE.BoxGeometry(0.18, 0.015, 0.015);
    crossGeo.translate(0.70, 0.42, -0.15);
    this.addInfraMesh(scene, crossGeo, pylonMat, cx, 0.08, cz);

    // Warning sign
    const signGeo = new THREE.BoxGeometry(0.10, 0.08, 0.015);
    signGeo.translate(0.70, 0.12, -0.55);
    const signMat = new THREE.MeshLambertMaterial({ color: 0xf0c030 });
    this.addInfraMesh(scene, signGeo, signMat, cx, 0.08, cz);

    // Status light
    const lightGeo = new THREE.BoxGeometry(0.08, 0.05, 0.08);
    lightGeo.translate(0.15, 0.65, 0.20);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.08, cz, false);
  }

  private buildWaterPump(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {

    // Concrete foundation
    const foundGeo = new THREE.BoxGeometry(1.70, 0.04, 1.70);
    foundGeo.translate(0, 0.02, 0);
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, foundGeo, foundMat, cx, 0.05, cz);

    // Perimeter fence
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const wpfF = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    wpfF.translate(0, 0.04, 0.84);
    this.addInfraMesh(scene, wpfF, fenceMat, cx, 0.05, cz);
    const wpfB = new THREE.BoxGeometry(1.70, 0.08, 0.015);
    wpfB.translate(0, 0.04, -0.84);
    this.addInfraMesh(scene, wpfB, fenceMat, cx, 0.05, cz);
    const wpfL = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    wpfL.translate(-0.84, 0.04, 0);
    this.addInfraMesh(scene, wpfL, fenceMat, cx, 0.05, cz);
    const wpfR = new THREE.BoxGeometry(0.015, 0.08, 1.70);
    wpfR.translate(0.84, 0.04, 0);
    this.addInfraMesh(scene, wpfR, fenceMat, cx, 0.05, cz);

    // Water tower tank (elevated)
    const tankGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.30, 12);
    tankGeo.translate(-0.35, 0.55 + 0.15, -0.15);
    const tankMat = new THREE.MeshLambertMaterial({ color: 0x29b6f6 });
    this.addInfraMesh(scene, tankGeo, tankMat, cx, 0.09, cz);

    // Tower cone roof
    const roofGeo = new THREE.ConeGeometry(0.30, 0.10, 12);
    roofGeo.translate(-0.35, 0.55 + 0.30 + 0.05, -0.15);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x0288d1 });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.09, cz);

    // 4 tower legs (wider spread)
    const legMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    const legOffsets = [
      [-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16],
    ];
    for (const [dx, dz] of legOffsets as [number, number][]) {
      const legGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6);
      legGeo.translate(-0.35 + dx, 0.275, -0.15 + dz);
      this.addInfraMesh(scene, legGeo, legMat, cx, 0.09, cz);
    }

    // 2 horizontal braces connecting legs at mid-height
    const braceGeo1 = new THREE.BoxGeometry(0.36, 0.015, 0.015);
    braceGeo1.translate(-0.35, 0.25, -0.15);
    this.addInfraMesh(scene, braceGeo1, legMat, cx, 0.09, cz);

    const braceGeo2 = new THREE.BoxGeometry(0.015, 0.015, 0.36);
    braceGeo2.translate(-0.35, 0.25, -0.15);
    this.addInfraMesh(scene, braceGeo2, legMat, cx, 0.09, cz);

    // Pump house
    const pumpGeo = new THREE.BoxGeometry(0.65, 0.45, 0.60);
    pumpGeo.translate(0.25, 0.225, 0.10);
    const pumpMat = new THREE.MeshLambertMaterial({ color: 0x4a6a7a });
    this.addInfraMesh(scene, pumpGeo, pumpMat, cx, 0.09, cz);

    // Pump house roof
    const pumpRoofGeo = new THREE.BoxGeometry(0.70, 0.03, 0.65);
    pumpRoofGeo.translate(0.25, 0.46, 0.10);
    const pumpRoofMat = new THREE.MeshLambertMaterial({ color: 0x3a5a6a });
    this.addInfraMesh(scene, pumpRoofGeo, pumpRoofMat, cx, 0.09, cz);

    // Filtration pool 1
    const poolGeo = new THREE.BoxGeometry(0.60, 0.08, 0.50);
    poolGeo.translate(0.20, 0.04, -0.50);
    const poolMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, poolGeo, poolMat, cx, 0.09, cz);

    // Pool 1 water surface
    const poolWaterGeo = new THREE.BoxGeometry(0.56, 0.01, 0.46);
    poolWaterGeo.translate(0.20, 0.085, -0.50);
    const poolWaterMat = new THREE.MeshLambertMaterial({ color: 0x4fc3f7 });
    this.addInfraMesh(scene, poolWaterGeo, poolWaterMat, cx, 0.09, cz);

    // Filtration pool 2 (second pool)
    const pool2Geo = new THREE.BoxGeometry(0.50, 0.08, 0.40);
    pool2Geo.translate(-0.35, 0.04, 0.50);
    this.addInfraMesh(scene, pool2Geo, poolMat, cx, 0.09, cz);

    // Pool 2 water surface
    const pool2WaterGeo = new THREE.BoxGeometry(0.46, 0.01, 0.36);
    pool2WaterGeo.translate(-0.35, 0.085, 0.50);
    this.addInfraMesh(scene, pool2WaterGeo, poolWaterMat, cx, 0.09, cz);

    // Main pipe (tower to pump house) — horizontal along X
    const mainPipeGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6);
    mainPipeGeo.rotateZ(Math.PI / 2);
    mainPipeGeo.translate(-0.05, 0.35, 0.00);
    const mainPipeMat = new THREE.MeshLambertMaterial({ color: 0x607888 });
    this.addInfraMesh(scene, mainPipeGeo, mainPipeMat, cx, 0.09, cz);

    // Inlet pipe — horizontal along Z
    const inletGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6);
    inletGeo.rotateX(Math.PI / 2);
    inletGeo.translate(0.25, 0.12, -0.22);
    const inletMat = new THREE.MeshLambertMaterial({ color: 0x4a8898 });
    this.addInfraMesh(scene, inletGeo, inletMat, cx, 0.09, cz);

    // Control gauge box
    const gaugeGeo = new THREE.BoxGeometry(0.08, 0.12, 0.02);
    gaugeGeo.translate(0.58, 0.30, 0.10);
    const gaugeMat = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
    this.addInfraMesh(scene, gaugeGeo, gaugeMat, cx, 0.09, cz);

    // Status light
    const lightGeo = new THREE.BoxGeometry(0.07, 0.05, 0.07);
    lightGeo.translate(0.25, 0.50, 0.10);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x03a9f4 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.09, cz, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP E — Land Transport (Bus / Metro / Train)
  // ═══════════════════════════════════════════════════════════════════

  private buildBusStop(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const y0 = 0.05;

    // Platform base
    const baseGeo = new THREE.BoxGeometry(0.40, 0.02, 0.25);
    baseGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, baseGeo, new THREE.MeshLambertMaterial({ color: 0xbdbdbd }), cx, y0, cz);

    // Shelter back panel
    const backGeo = new THREE.BoxGeometry(0.28, 0.15, 0.01);
    backGeo.translate(0, 0.075, -0.065);
    this.addInfraMesh(scene, backGeo, new THREE.MeshLambertMaterial({ color: 0xffe0b2 }), cx, y0 + 0.02, cz);

    // Shelter poles (front-left and front-right)
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
    const poleGeoL = new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6);
    poleGeoL.translate(-0.12, 0.09, 0.06);
    this.addInfraMesh(scene, poleGeoL, poleMat, cx, y0 + 0.02, cz);

    const poleGeoR = new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6);
    poleGeoR.translate(0.12, 0.09, 0.06);
    this.addInfraMesh(scene, poleGeoR, poleMat.clone(), cx, y0 + 0.02, cz);

    // Shelter roof
    const roofGeo = new THREE.BoxGeometry(0.28, 0.015, 0.14);
    roofGeo.translate(0, 0.18, 0);
    this.addInfraMesh(scene, roofGeo, new THREE.MeshLambertMaterial({ color: 0xff9800 }), cx, y0 + 0.02, cz);

    // Sign pole (to the right side)
    const signPoleGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.22, 4);
    signPoleGeo.translate(0.16, 0.11, 0.08);
    this.addInfraMesh(scene, signPoleGeo, new THREE.MeshLambertMaterial({ color: 0x888888 }), cx, y0 + 0.02, cz);

    // Bus sign
    const signGeo = new THREE.BoxGeometry(0.05, 0.05, 0.01);
    signGeo.translate(0.16, 0.23, 0.08);
    this.addInfraMesh(scene, signGeo, new THREE.MeshLambertMaterial({ color: 0xff9800 }), cx, y0 + 0.02, cz);

    // Bench
    const benchGeo = new THREE.BoxGeometry(0.12, 0.02, 0.03);
    benchGeo.translate(-0.02, 0.05, 0.02);
    this.addInfraMesh(scene, benchGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, y0 + 0.02, cz);
  }

  private buildMetroStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const y0 = 0.05;

    // Entrance base structure
    const baseGeo = new THREE.BoxGeometry(0.35, 0.08, 0.30);
    baseGeo.translate(0, 0.04, 0);
    this.addInfraMesh(scene, baseGeo, new THREE.MeshLambertMaterial({ color: 0x455a64 }), cx, y0, cz);

    // Arch entrance (half-cylinder laid on its side to form tunnel arch)
    const archGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.30, 8, 1, false, 0, Math.PI);
    archGeo.rotateX(-Math.PI / 2);
    archGeo.translate(0, 0.08, 0.02);
    this.addInfraMesh(scene, archGeo, new THREE.MeshLambertMaterial({ color: 0x1565c0 }), cx, y0, cz);

    // Steps going down into the station (3 steps, descending toward +z)
    const stepMat = new THREE.MeshLambertMaterial({ color: 0x607d8b });

    const step1Geo = new THREE.BoxGeometry(0.25, 0.03, 0.08);
    step1Geo.translate(0, 0.065, 0.06);
    this.addInfraMesh(scene, step1Geo, stepMat, cx, y0, cz);

    const step2Geo = new THREE.BoxGeometry(0.25, 0.03, 0.08);
    step2Geo.translate(0, 0.04, 0.13);
    this.addInfraMesh(scene, step2Geo, stepMat.clone(), cx, y0, cz);

    const step3Geo = new THREE.BoxGeometry(0.25, 0.03, 0.08);
    step3Geo.translate(0, 0.015, 0.20);
    this.addInfraMesh(scene, step3Geo, stepMat.clone(), cx, y0, cz);

    // Railings on each side of stairs
    const railMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const railLGeo = new THREE.BoxGeometry(0.01, 0.06, 0.15);
    railLGeo.translate(-0.13, 0.06, 0.13);
    this.addInfraMesh(scene, railLGeo, railMat, cx, y0, cz);

    const railRGeo = new THREE.BoxGeometry(0.01, 0.06, 0.15);
    railRGeo.translate(0.13, 0.06, 0.13);
    this.addInfraMesh(scene, railRGeo, railMat.clone(), cx, y0, cz);

    // Ventilation shaft (to the side)
    const ventGeo = new THREE.BoxGeometry(0.10, 0.12, 0.10);
    ventGeo.translate(-0.18, 0.06, -0.10);
    this.addInfraMesh(scene, ventGeo, new THREE.MeshLambertMaterial({ color: 0x78909c }), cx, y0, cz);

    // Vent grille on top
    const grilleGeo = new THREE.BoxGeometry(0.08, 0.01, 0.08);
    grilleGeo.translate(-0.18, 0.125, -0.10);
    this.addInfraMesh(scene, grilleGeo, new THREE.MeshLambertMaterial({ color: 0x546e7a }), cx, y0, cz);

    // M logo circle (glowing, on arch front)
    const mLogoGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10);
    mLogoGeo.rotateX(Math.PI / 2);
    mLogoGeo.translate(0, 0.16, 0.14);
    this.addInfraMesh(scene, mLogoGeo, new THREE.MeshBasicMaterial({ color: 0x2196f3 }), cx, y0, cz, false);
  }

  private buildTrainStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const y0 = 0.05;

    // Station house (main building)
    const houseGeo = new THREE.BoxGeometry(0.40, 0.35, 0.45);
    houseGeo.translate(0, 0.175, -0.10);
    this.addInfraMesh(scene, houseGeo, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, y0, cz);

    // Station pitched roof (rotated cone = diamond shape)
    const roofGeo = new THREE.ConeGeometry(0.28, 0.12, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.41, -0.10);
    this.addInfraMesh(scene, roofGeo, new THREE.MeshLambertMaterial({ color: 0x5d4037 }), cx, y0, cz);

    // Clock tower (center of roof)
    const towerGeo = new THREE.BoxGeometry(0.10, 0.25, 0.10);
    towerGeo.translate(0, 0.475, -0.10);
    this.addInfraMesh(scene, towerGeo, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, y0, cz);

    // Tower spire
    const spireGeo = new THREE.ConeGeometry(0.07, 0.08, 4);
    spireGeo.translate(0, 0.64, -0.10);
    this.addInfraMesh(scene, spireGeo, new THREE.MeshLambertMaterial({ color: 0x4e342e }), cx, y0, cz);

    // Clock face (on tower front, facing +z)
    const clockGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
    clockGeo.rotateX(Math.PI / 2);
    clockGeo.translate(0, 0.50, -0.04);
    this.addInfraMesh(scene, clockGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cx, y0, cz);

    // Entrance arch (front of station house)
    const archGeo = new THREE.BoxGeometry(0.20, 0.25, 0.04);
    archGeo.translate(0, 0.125, 0.14);
    this.addInfraMesh(scene, archGeo, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, y0, cz);

    // Platform surface (extends to the side of the station)
    const platGeo = new THREE.BoxGeometry(0.75, 0.03, 0.25);
    platGeo.translate(0, 0.015, 0.30);
    this.addInfraMesh(scene, platGeo, new THREE.MeshLambertMaterial({ color: 0xbdbdbd }), cx, y0, cz);

    // Platform canopy (long roof over platform)
    const canopyGeo = new THREE.BoxGeometry(0.70, 0.015, 0.20);
    canopyGeo.translate(0, 0.28, 0.30);
    this.addInfraMesh(scene, canopyGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, y0, cz);

    // 4 canopy pillars
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0xa1887f });

    const p1Geo = new THREE.CylinderGeometry(0.010, 0.010, 0.25, 6);
    p1Geo.translate(-0.30, 0.125, 0.22);
    this.addInfraMesh(scene, p1Geo, pillarMat, cx, y0 + 0.03, cz);

    const p2Geo = new THREE.CylinderGeometry(0.010, 0.010, 0.25, 6);
    p2Geo.translate(0.30, 0.125, 0.22);
    this.addInfraMesh(scene, p2Geo, pillarMat.clone(), cx, y0 + 0.03, cz);

    const p3Geo = new THREE.CylinderGeometry(0.010, 0.010, 0.25, 6);
    p3Geo.translate(-0.30, 0.125, 0.38);
    this.addInfraMesh(scene, p3Geo, pillarMat.clone(), cx, y0 + 0.03, cz);

    const p4Geo = new THREE.CylinderGeometry(0.010, 0.010, 0.25, 6);
    p4Geo.translate(0.30, 0.125, 0.38);
    this.addInfraMesh(scene, p4Geo, pillarMat.clone(), cx, y0 + 0.03, cz);

    // 2 rail tracks (parallel beside platform, on the +z side)
    const railMat = new THREE.MeshLambertMaterial({ color: 0x616161 });
    const rail1Geo = new THREE.BoxGeometry(0.75, 0.01, 0.015);
    rail1Geo.translate(0, 0.005, 0.46);
    this.addInfraMesh(scene, rail1Geo, railMat, cx, y0, cz);

    const rail2Geo = new THREE.BoxGeometry(0.75, 0.01, 0.015);
    rail2Geo.translate(0, 0.005, 0.50);
    this.addInfraMesh(scene, rail2Geo, railMat.clone(), cx, y0, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP F — Other Transport (Ferry / Airport / Taxi)
  // ═══════════════════════════════════════════════════════════════════

  private buildFerryDock(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const y0 = 0.05;

    // Shore-side concrete base (back half of cell)
    const shoreGeo = new THREE.BoxGeometry(0.80, 0.03, 0.35);
    shoreGeo.translate(0, 0.015, -0.22);
    this.addInfraMesh(scene, shoreGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, y0, cz, false);

    // Main wooden pier deck (extends forward into water area)
    const deckGeo = new THREE.BoxGeometry(0.75, 0.04, 0.50);
    deckGeo.translate(0, 0.02, 0.15);
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    this.addInfraMesh(scene, deckGeo, deckMat, cx, y0, cz);

    // 8 pier support stilts under deck
    const stiltMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
    const stiltOffsets: [number, number][] = [
      [-0.30, 0.00], [-0.30, 0.28], [0.00, 0.00], [0.00, 0.28],
      [0.30, 0.00], [0.30, 0.28], [-0.15, 0.14], [0.15, 0.14],
    ];
    for (const [dx, dz] of stiltOffsets) {
      const stiltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.10, 5);
      stiltGeo.translate(0, -0.03, 0);
      this.addInfraMesh(scene, stiltGeo, stiltMat, cx + dx, y0, cz + dz);
    }

    // Ticket / waiting shelter building (on shore side)
    const shelterGeo = new THREE.BoxGeometry(0.30, 0.22, 0.25);
    shelterGeo.translate(-0.18, 0.11, -0.22);
    const shelterMat = new THREE.MeshLambertMaterial({ color: 0x00838f });
    this.addInfraMesh(scene, shelterGeo, shelterMat, cx, y0 + 0.03, cz);

    // Shelter roof
    const shelterRoofGeo = new THREE.BoxGeometry(0.34, 0.02, 0.28);
    shelterRoofGeo.translate(-0.18, 0.23, -0.22);
    const shelterRoofMat = new THREE.MeshLambertMaterial({ color: 0x006064 });
    this.addInfraMesh(scene, shelterRoofGeo, shelterRoofMat, cx, y0 + 0.03, cz);

    // Pier canopy (shade over boarding area)
    const canopyGeo = new THREE.BoxGeometry(0.50, 0.015, 0.25);
    canopyGeo.translate(0, 0.28, 0.10);
    this.addInfraMesh(scene, canopyGeo, new THREE.MeshLambertMaterial({ color: 0x00695c }), cx, y0, cz);

    // 4 canopy pillars
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const pillarPos: [number, number][] = [[-0.22, 0.00], [0.22, 0.00], [-0.22, 0.20], [0.22, 0.20]];
    for (const [dx, dz] of pillarPos) {
      const pGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6);
      pGeo.translate(0, 0.16, 0);
      this.addInfraMesh(scene, pGeo, pillarMat, cx + dx, y0, cz + dz);
    }

    // Lighthouse (taller, on pier corner)
    const lighthouseGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.32, 8);
    lighthouseGeo.translate(0, 0.16, 0);
    const lighthouseMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
    this.addInfraMesh(scene, lighthouseGeo, lighthouseMat, cx + 0.32, y0 + 0.04, cz + 0.28);

    // Lighthouse red band
    const lhBandGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.04, 8);
    lhBandGeo.translate(0, 0.28, 0);
    this.addInfraMesh(scene, lhBandGeo, new THREE.MeshLambertMaterial({ color: 0xd32f2f }), cx + 0.32, y0 + 0.04, cz + 0.28);

    // Lighthouse lamp
    const lampGeo = new THREE.SphereGeometry(0.035, 6, 5);
    lampGeo.translate(0, 0.35, 0);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });
    this.addInfraMesh(scene, lampGeo, lampMat, cx + 0.32, y0 + 0.04, cz + 0.28, false);

    // 4 mooring bollards along pier edge
    const bollardMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    const bollardPositions: [number, number][] = [
      [-0.28, 0.35], [-0.08, 0.35], [0.12, 0.35], [0.30, 0.10],
    ];
    for (const [dx, dz] of bollardPositions) {
      const bollardGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 6);
      bollardGeo.translate(0, 0.07, 0);
      this.addInfraMesh(scene, bollardGeo, bollardMat, cx + dx, y0, cz + dz);
    }

    // Gangway / ramp (angled boarding plank)
    const rampGeo = new THREE.BoxGeometry(0.18, 0.02, 0.12);
    rampGeo.rotateX(0.15);
    rampGeo.translate(0, 0.05, 0.38);
    this.addInfraMesh(scene, rampGeo, new THREE.MeshLambertMaterial({ color: 0xa1887f }), cx, y0, cz);

    // Parked boat hull (low-poly box boat at dock)
    const hullGeo = new THREE.BoxGeometry(0.12, 0.06, 0.28);
    hullGeo.translate(0, 0.03, 0);
    this.addInfraMesh(scene, hullGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cx - 0.08, y0 - 0.01, cz + 0.30);

    // Boat cabin
    const cabinGeo = new THREE.BoxGeometry(0.08, 0.05, 0.10);
    cabinGeo.translate(0, 0.08, -0.05);
    this.addInfraMesh(scene, cabinGeo, new THREE.MeshLambertMaterial({ color: 0x0277bd }), cx - 0.08, y0 - 0.01, cz + 0.30);

    // 2 buoys in water
    const buoyMat = new THREE.MeshLambertMaterial({ color: 0xff5722 });
    const buoy1Geo = new THREE.SphereGeometry(0.025, 6, 4);
    buoy1Geo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, buoy1Geo, buoyMat, cx - 0.35, y0, cz + 0.38);

    const buoy2Geo = new THREE.SphereGeometry(0.025, 6, 4);
    buoy2Geo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, buoy2Geo, buoyMat, cx + 0.20, y0, cz + 0.40);

    // Safety railing on pier edges (left and right)
    const railMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    const railLGeo = new THREE.BoxGeometry(0.01, 0.06, 0.50);
    railLGeo.translate(-0.37, 0.07, 0.15);
    this.addInfraMesh(scene, railLGeo, railMat, cx, y0, cz);

    const railRGeo = new THREE.BoxGeometry(0.01, 0.06, 0.50);
    railRGeo.translate(0.37, 0.07, 0.15);
    this.addInfraMesh(scene, railRGeo, railMat, cx, y0, cz);
  }

  // ── SMALL Airport (5×4) — same layout as old Medium ─────────
  private buildAirportSmall(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const Y = 0.05;
    // Footprint ground (5×4)
    const groundGeo = new THREE.BoxGeometry(4.80, 0.02, 3.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, Y, cz, false);
    const termMat = new THREE.MeshLambertMaterial({ color: 0xeceff1 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x2196f3 });
    const runwayMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const apronMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });

    // Terminal
    const termGeo = new THREE.BoxGeometry(3.00, 0.50, 0.70);
    termGeo.translate(0, 0.25, -1.20);
    this.addInfraMesh(scene, termGeo, termMat, cx, Y, cz);
    // Roof
    const roofGeo = new THREE.BoxGeometry(3.08, 0.03, 0.76);
    roofGeo.translate(0, 0.525, -1.20);
    this.addInfraMesh(scene, roofGeo, roofMat, cx, Y, cz);
    // Accent
    const accGeo = new THREE.BoxGeometry(3.00, 0.06, 0.01);
    accGeo.translate(0, 0.25, -1.20 + 0.355);
    this.addInfraMesh(scene, accGeo, accentMat, cx, Y, cz);
    // Control tower
    const stemGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.65, 8);
    stemGeo.translate(-1.80, 0.325, -1.20);
    this.addInfraMesh(scene, stemGeo, new THREE.MeshLambertMaterial({ color: 0xcfd8dc }), cx, Y, cz);
    const cabGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.12, 8);
    cabGeo.translate(-1.80, 0.72, -1.20);
    this.addInfraMesh(scene, cabGeo, new THREE.MeshLambertMaterial({ color: 0x90caf9 }), cx, Y, cz);
    // 3 jet bridges
    for (const dx of [-0.60, 0, 0.60]) {
      const bGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
      bGeo.translate(dx, 0.18, -0.80);
      this.addInfraMesh(scene, bGeo, bridgeMat, cx, Y, cz);
    }
    // Hangar (right side, away from tower)
    const hangarGeo = new THREE.BoxGeometry(0.50, 0.35, 0.45);
    hangarGeo.translate(1.90, 0.175, -1.20);
    this.addInfraMesh(scene, hangarGeo, new THREE.MeshLambertMaterial({ color: 0x808080 }), cx, Y, cz);
    // Apron (full width to reach both taxiways)
    const apronGeo = new THREE.BoxGeometry(4.10, 0.01, 0.70);
    apronGeo.translate(0, 0.02, -0.35);
    this.addInfraMesh(scene, apronGeo, apronMat, cx, Y, cz, false);
    const taxiMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    // Left taxiway
    const taxiL = new THREE.BoxGeometry(0.45, 0.01, 1.20);
    taxiL.translate(-1.80, 0.018, 0.60);
    this.addInfraMesh(scene, taxiL, taxiMat, cx, Y, cz, false);
    // Right taxiway
    const taxiR = new THREE.BoxGeometry(0.45, 0.01, 1.20);
    taxiR.translate(1.80, 0.018, 0.60);
    this.addInfraMesh(scene, taxiR, taxiMat, cx, Y, cz, false);
    // Runway
    const rwGeo = new THREE.BoxGeometry(4.50, 0.01, 0.68);
    rwGeo.translate(0, 0.02, 1.20);
    this.addInfraMesh(scene, rwGeo, runwayMat, cx, Y, cz, false);
    // Dashes
    for (let i = 0; i < 40; i++) {
      const dx = -2.00 + i * (4.00 / 39);
      const dGeo = new THREE.BoxGeometry(0.045, 0.012, 0.013);
      dGeo.translate(dx, 0.025, 1.20);
      this.addInfraMesh(scene, dGeo, dashMat, cx, Y, cz, false);
    }
    // Threshold
    const thrGeo = new THREE.BoxGeometry(0.04, 0.012, 0.40);
    thrGeo.translate(2.20, 0.025, 1.20);
    this.addInfraMesh(scene, thrGeo, dashMat, cx, Y, cz, false);
  }

  // ── MEDIUM Airport (7×4) ────────────────────────────────────
  private buildAirportMedium(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const Y = 0.05;
    // Footprint ground (7×4)
    const groundGeo = new THREE.BoxGeometry(6.80, 0.02, 3.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, Y, cz, false);
    const termMat = new THREE.MeshLambertMaterial({ color: 0xeceff1 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x2196f3 });
    const runwayMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const apronMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });

    // Terminal
    const termGeo = new THREE.BoxGeometry(4.20, 0.50, 0.70);
    termGeo.translate(0, 0.25, -1.20);
    this.addInfraMesh(scene, termGeo, termMat, cx, Y, cz);
    // Roof
    const roofGeo = new THREE.BoxGeometry(4.28, 0.03, 0.76);
    roofGeo.translate(0, 0.525, -1.20);
    this.addInfraMesh(scene, roofGeo, roofMat, cx, Y, cz);
    // Accent
    const accGeo = new THREE.BoxGeometry(4.20, 0.06, 0.01);
    accGeo.translate(0, 0.25, -1.20 + 0.355);
    this.addInfraMesh(scene, accGeo, accentMat, cx, Y, cz);
    // Control tower
    const stemGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.65, 8);
    stemGeo.translate(-2.80, 0.325, -1.20);
    this.addInfraMesh(scene, stemGeo, new THREE.MeshLambertMaterial({ color: 0xcfd8dc }), cx, Y, cz);
    const cabGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.12, 8);
    cabGeo.translate(-2.80, 0.72, -1.20);
    this.addInfraMesh(scene, cabGeo, new THREE.MeshLambertMaterial({ color: 0x90caf9 }), cx, Y, cz);
    // 4 jet bridges
    for (const dx of [-0.90, -0.30, 0.30, 0.90]) {
      const bGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
      bGeo.translate(dx, 0.18, -0.80);
      this.addInfraMesh(scene, bGeo, bridgeMat, cx, Y, cz);
    }
    // Hangar (right side, away from tower)
    const hangarGeo = new THREE.BoxGeometry(0.50, 0.35, 0.45);
    hangarGeo.translate(2.90, 0.175, -1.20);
    this.addInfraMesh(scene, hangarGeo, new THREE.MeshLambertMaterial({ color: 0x808080 }), cx, Y, cz);
    // Apron (full width to reach both taxiways)
    const apronGeo = new THREE.BoxGeometry(6.10, 0.01, 0.70);
    apronGeo.translate(0, 0.02, -0.35);
    this.addInfraMesh(scene, apronGeo, apronMat, cx, Y, cz, false);
    const taxiMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    // Left taxiway
    const taxiL = new THREE.BoxGeometry(0.45, 0.01, 1.20);
    taxiL.translate(-2.80, 0.018, 0.60);
    this.addInfraMesh(scene, taxiL, taxiMat, cx, Y, cz, false);
    // Right taxiway
    const taxiR = new THREE.BoxGeometry(0.45, 0.01, 1.20);
    taxiR.translate(2.80, 0.018, 0.60);
    this.addInfraMesh(scene, taxiR, taxiMat, cx, Y, cz, false);
    // Runway
    const rwGeo = new THREE.BoxGeometry(6.50, 0.01, 0.68);
    rwGeo.translate(0, 0.02, 1.20);
    this.addInfraMesh(scene, rwGeo, runwayMat, cx, Y, cz, false);
    // Dashes
    for (let i = 0; i < 40; i++) {
      const dx = -3.00 + i * (6.00 / 39);
      const dGeo = new THREE.BoxGeometry(0.045, 0.012, 0.013);
      dGeo.translate(dx, 0.025, 1.20);
      this.addInfraMesh(scene, dGeo, dashMat, cx, Y, cz, false);
    }
    // Threshold
    const thrGeo = new THREE.BoxGeometry(0.04, 0.012, 0.40);
    thrGeo.translate(3.20, 0.025, 1.20);
    this.addInfraMesh(scene, thrGeo, dashMat, cx, Y, cz, false);
  }

  // ── LARGE Airport (9×6) — dual runway ───────────────────────
  private buildAirportLarge(scene: THREE.Scene | THREE.Group, cx: number, cz: number): void {
    const Y = 0.05;
    // Footprint ground (9×6)
    const groundGeo = new THREE.BoxGeometry(8.80, 0.02, 5.80);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), cx, Y, cz, false);
    const termMat = new THREE.MeshLambertMaterial({ color: 0xeceff1 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x2196f3 });
    const runwayMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const apronMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });

    // Main Terminal (top area)
    const termGeo = new THREE.BoxGeometry(5.40, 0.60, 0.80);
    termGeo.translate(0, 0.30, -2.20);
    this.addInfraMesh(scene, termGeo, termMat, cx, Y, cz);
    // Roof
    const roofGeo = new THREE.BoxGeometry(5.48, 0.03, 0.86);
    roofGeo.translate(0, 0.63, -2.20);
    this.addInfraMesh(scene, roofGeo, roofMat, cx, Y, cz);
    // Accent
    const accGeo = new THREE.BoxGeometry(5.40, 0.07, 0.01);
    accGeo.translate(0, 0.30, -2.20 + 0.405);
    this.addInfraMesh(scene, accGeo, accentMat, cx, Y, cz);
    // Control tower (tall)
    const stemGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.90, 10);
    stemGeo.translate(3.60, 0.45, -2.20);
    this.addInfraMesh(scene, stemGeo, new THREE.MeshLambertMaterial({ color: 0xcfd8dc }), cx, Y, cz);
    const cabGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.14, 10);
    cabGeo.translate(3.60, 0.97, -2.20);
    this.addInfraMesh(scene, cabGeo, new THREE.MeshLambertMaterial({ color: 0x90caf9 }), cx, Y, cz);
    // Hangar (left of terminal, with gap)
    const hangarGeo = new THREE.BoxGeometry(0.55, 0.35, 0.45);
    hangarGeo.translate(-3.60, 0.175, -2.20);
    this.addInfraMesh(scene, hangarGeo, new THREE.MeshLambertMaterial({ color: 0x808080 }), cx, Y, cz);
    // 6 jet bridges
    for (const dx of [-1.75, -1.05, -0.35, 0.35, 1.05, 1.75]) {
      const bGeo = new THREE.BoxGeometry(0.12, 0.08, 0.14);
      bGeo.translate(dx, 0.18, -1.74);
      this.addInfraMesh(scene, bGeo, bridgeMat, cx, Y, cz);
    }
    // Apron (full width to reach both taxiways)
    const apronGeo = new THREE.BoxGeometry(8.10, 0.01, 0.80);
    apronGeo.translate(0, 0.02, -1.20);
    this.addInfraMesh(scene, apronGeo, apronMat, cx, Y, cz, false);
    // Left taxiway
    const taxiMat = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const taxiL = new THREE.BoxGeometry(0.45, 0.01, 3.40);
    taxiL.translate(-3.80, 0.018, 0.80);
    this.addInfraMesh(scene, taxiL, taxiMat, cx, Y, cz, false);
    // Right taxiway
    const taxiR = new THREE.BoxGeometry(0.45, 0.01, 3.40);
    taxiR.translate(3.80, 0.018, 0.80);
    this.addInfraMesh(scene, taxiR, taxiMat, cx, Y, cz, false);
    // Runway 1
    const rw1Geo = new THREE.BoxGeometry(8.50, 0.01, 0.68);
    rw1Geo.translate(0, 0.02, 0.80);
    this.addInfraMesh(scene, rw1Geo, runwayMat, cx, Y, cz, false);
    for (let i = 0; i < 50; i++) {
      const dx = -4.00 + i * (8.00 / 49);
      const dGeo = new THREE.BoxGeometry(0.050, 0.012, 0.013);
      dGeo.translate(dx, 0.025, 0.80);
      this.addInfraMesh(scene, dGeo, dashMat, cx, Y, cz, false);
    }
    const thr1 = new THREE.BoxGeometry(0.04, 0.012, 0.60);
    thr1.translate(4.20, 0.025, 0.80);
    this.addInfraMesh(scene, thr1, dashMat, cx, Y, cz, false);
    // Runway 2
    const rw2Geo = new THREE.BoxGeometry(8.50, 0.01, 0.68);
    rw2Geo.translate(0, 0.02, 2.20);
    this.addInfraMesh(scene, rw2Geo, runwayMat, cx, Y, cz, false);
    for (let i = 0; i < 50; i++) {
      const dx = -4.00 + i * (8.00 / 49);
      const dGeo = new THREE.BoxGeometry(0.050, 0.012, 0.013);
      dGeo.translate(dx, 0.025, 2.20);
      this.addInfraMesh(scene, dGeo, dashMat, cx, Y, cz, false);
    }
    const thr2 = new THREE.BoxGeometry(0.04, 0.012, 0.60);
    thr2.translate(4.20, 0.025, 2.20);
    this.addInfraMesh(scene, thr2, dashMat, cx, Y, cz, false);
  }

  // ═══════════════════════════════════════════════════════════════════

  private addInfraMesh(scene: THREE.Scene | THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): void {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
  }

  /** Initialize pre-allocated lightSpotMesh (called once). */
  private initLightSpotMesh(scene: THREE.Scene): void {
    if (this.lightSpotMesh) return;

    const glowRadius = 0.3;
    const glowSegs = 10;
    const geometry = new THREE.CircleGeometry(glowRadius, glowSegs);
    geometry.rotateX(-Math.PI / 2);
    const posAttr = geometry.attributes.position!;
    const vColors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / glowRadius;
      const b = Math.max(0, 1 - dist);
      vColors[i * 3] = b;
      vColors[i * 3 + 1] = b;
      vColors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(vColors, 3));

    this.lightSpotMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.lightSpotMesh = new THREE.InstancedMesh(geometry, this.lightSpotMaterial, this.maxPerVariant);
    this.lightSpotMesh.count = 0;
    this.lightSpotMesh.frustumCulled = false;
    this.lightSpotMesh.renderOrder = 2;
    this.lightSpotPosToIdx.clear();
    this.lightSpotIdxToPos.length = 0;
    this.lightSpotCount = 0;
    scene.add(this.lightSpotMesh);
  }

  /** Populate lightSpots from positions (used by build). */
  private buildLightSpots(scene: THREE.Scene, positions: { x: number; y: number }[]): void {
    this.initLightSpotMesh(scene);
    for (const p of positions) {
      this.addLightSpot(p.x, p.y);
    }
  }

  /** Add a single lightSpot at (x, y). O(1). */
  addLightSpot(x: number, y: number): void {
    if (!this.lightSpotMesh || this.lightSpotCount >= this.maxPerVariant) return;
    const posKey = `${x},${y}`;
    if (this.lightSpotPosToIdx.has(posKey)) return; // already exists

    const idx = this.lightSpotCount;
    this._matrix.identity();
    this._matrix.setPosition(x, 0.03, y);
    this.lightSpotMesh.setMatrixAt(idx, this._matrix);
    this.lightSpotPosToIdx.set(posKey, idx);
    this.lightSpotIdxToPos[idx] = posKey;
    this.lightSpotCount++;
    this.lightSpotMesh.count = this.lightSpotCount;
    this.lightSpotMesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove a single lightSpot at (x, y). O(1) swap-with-last. */
  removeLightSpot(x: number, y: number): void {
    if (!this.lightSpotMesh) return;
    const posKey = `${x},${y}`;
    const idx = this.lightSpotPosToIdx.get(posKey);
    if (idx === undefined) return;

    const lastIdx = this.lightSpotCount - 1;
    if (idx !== lastIdx) {
      // Swap with last
      this.lightSpotMesh.getMatrixAt(lastIdx, this._matrix);
      this.lightSpotMesh.setMatrixAt(idx, this._matrix);
      const movedKey = this.lightSpotIdxToPos[lastIdx]!;
      this.lightSpotPosToIdx.set(movedKey, idx);
      this.lightSpotIdxToPos[idx] = movedKey;
    }
    this.lightSpotPosToIdx.delete(posKey);
    this.lightSpotIdxToPos.length = lastIdx;
    this.lightSpotCount--;
    this.lightSpotMesh.count = this.lightSpotCount;
    this.lightSpotMesh.instanceMatrix.needsUpdate = true;
  }

  /** Update per-instance occupancy attribute from occupancy ratio map. */
  updateOccupancy(ratios: Map<string, number>): void {
    for (const [key, mesh] of this.variantMeshes) {
      const i2p = this.instanceToPosition.get(key)!;
      const occAttr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
      if (!occAttr) continue;
      const arr = occAttr.array as Float32Array;
      const count = this.variantCounts.get(key) ?? 0;
      for (let i = 0; i < count; i++) {
        const posKey = i2p.get(i);
        arr[i] = posKey ? (ratios.get(posKey) ?? 0) : 0;
      }
      occAttr.needsUpdate = true;
    }
  }

  private _elapsedTime = 0;

  /** Update light spot visibility based on sun intensity (call each frame). */
  update(sunIntensity: number, dt?: number): void {
    if (dt) {
      this._elapsedTime += dt;
      getBuildingMaterial().uniforms['uTime']!.value = this._elapsedTime;
    }
    if (!this.lightSpotMaterial) return;
    if (this._focusMode) {
      this.lightSpotMaterial.opacity = 0;
      return;
    }
    this.lightSpotMaterial.opacity = Math.max(0, 0.4 * (1 - sunIntensity / 0.45));
  }

  private _focusMode = false;
  private _whiteModelMesh: THREE.Mesh | null = null;
  private static _whiteModelMat: THREE.ShaderMaterial | null = null;

  private static getWhiteModelMat(): THREE.ShaderMaterial {
    if (!BuildingRenderer._whiteModelMat) {
      BuildingRenderer._whiteModelMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uColor: { value: new THREE.Color(0xe0e0e0) },
          uOpacity: { value: 0.5 },
        },
        vertexShader: /* glsl */ `
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          out vec4 fragColor;

          // 4×4 Bayer matrix (values 0..15 normalized to 0..1)
          const float bayer[16] = float[16](
             0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
            12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
             3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
            15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
          );

          void main() {
            int ix = int(gl_FragCoord.x) % 4;
            int iy = int(gl_FragCoord.y) % 4;
            float threshold = bayer[iy * 4 + ix];
            if (uOpacity < threshold) discard;
            fragColor = vec4(uColor, 1.0);
          }
        `,
      });
    }
    return BuildingRenderer._whiteModelMat;
  }

  /** Switch view mode — any non-NORMAL mode shows white model. */
  setViewMode(mode: ViewMode, scene?: THREE.Scene): void {
    const enabled = mode !== ViewMode.NORMAL;
    this._focusMode = enabled;

    if (enabled && scene) {
      // Hide originals
      for (const mesh of this.variantMeshes.values()) mesh.visible = false;
      for (const mesh of this.overlayMeshes) mesh.visible = false;
      for (const group of this.infraGroups) group.visible = false;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = false;

      // Build merged white model mesh
      this.buildWhiteModelMesh(scene);
    } else {
      // Remove white model mesh
      if (this._whiteModelMesh && scene) {
        scene.remove(this._whiteModelMesh);
        this._whiteModelMesh.geometry.dispose();
        this._whiteModelMesh = null;
      }

      // Restore originals
      for (const mesh of this.variantMeshes.values()) {
        mesh.visible = true;
        mesh.material = getBuildingMaterial();
        mesh.renderOrder = 0;
      }
      for (const mesh of this.overlayMeshes) {
        mesh.visible = true;
      }
      for (const group of this.infraGroups) group.visible = true;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = true;
    }
  }

  /** Bake all building InstancedMeshes + infra into one merged white model mesh. */
  private buildWhiteModelMesh(scene: THREE.Scene): void {
    // Remove old one if exists
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    const geos: THREE.BufferGeometry[] = [];
    const mat4 = new THREE.Matrix4();

    // Bake persistent variant meshes
    for (const mesh of this.variantMeshes.values()) {
      const srcGeo = mesh.geometry;
      const count = mesh.count;
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, mat4);
        const clone = srcGeo.clone();
        clone.applyMatrix4(mat4);
        clone.deleteAttribute('color');
        if (clone.hasAttribute('aHighlight')) clone.deleteAttribute('aHighlight');
        if (clone.hasAttribute('aHighlightColor')) clone.deleteAttribute('aHighlightColor');
        if (clone.hasAttribute('aOccupancy')) clone.deleteAttribute('aOccupancy');
        geos.push(clone);
      }
    }

    // Bake infra group meshes
    for (const group of this.infraGroups) {
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const clone = child.geometry.clone();
          child.updateWorldMatrix(true, false);
          clone.applyMatrix4(child.matrixWorld);
          clone.deleteAttribute('color');
          geos.push(clone);
        }
      });
    }

    if (geos.length === 0) return;

    const merged = mergeGeometries(geos, false);
    if (!merged) return;

    // Dispose cloned geos
    for (const g of geos) g.dispose();

    this._whiteModelMesh = new THREE.Mesh(merged, BuildingRenderer.getWhiteModelMat());
    this._whiteModelMesh.renderOrder = 20;
    this._whiteModelMesh.frustumCulled = false;
    scene.add(this._whiteModelMesh);
  }

  /** Dispose non-persistent resources (overlays, infra, light spots). Called during rebuild. */
  private disposeNonPersistent(scene: THREE.Scene): void {
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    for (const mesh of this.overlayMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
    this.overlayMeshes = [];
    this.overlayIndex.clear();
    this._buildingMeshesDirty = true;

    for (const group of this.infraGroups) {
      scene.remove(group);
      disposeGroup(group);
    }
    this.infraGroups = [];
    this.infraIndex.clear();

    // Reset lightSpot tracking (mesh kept alive for incremental reuse)
    if (this.lightSpotMesh) {
      this.lightSpotMesh.count = 0;
      this.lightSpotMesh.instanceMatrix.needsUpdate = true;
    }
    this.lightSpotPosToIdx.clear();
    this.lightSpotIdxToPos.length = 0;
    this.lightSpotCount = 0;
  }

  /** Full dispose including persistent variant meshes (game exit / cleanup). */
  dispose(scene: THREE.Scene): void {
    this.disposeNonPersistent(scene);

    // Dispose persistent variant meshes
    for (const mesh of this.variantMeshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.variantMeshes.clear();
    this.variantCounts.clear();
    this.positionToInstance.clear();
    this.instanceToPosition.clear();
    this.variantInitialized = false;
  }
}

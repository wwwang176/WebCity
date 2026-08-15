import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { getBuildingMaterial } from './BuildingMaterial';
import { paletteFor } from './ColorPalettes';
import { appearanceOf } from './BuildingAppearance';
import {
  ZONE_TYPES, LEVELS, TARGET_HEIGHTS_M, heightKey, bucketKey,
  type Density, type GeoBuilder,
} from './geometry/buildings/registry';
import { getMassingVariants, VARIANT_COUNT, floorHeightOf, isRoundBodied } from './geometry/buildings/massing';
import { FLOOR_HEIGHT_UNITS } from './geometry/buildings/massing/metrics';
import { getGroundPropVariants } from './geometry/buildings/groundProps';
import { getDecalVariants } from './geometry/buildings/decals';
import { getOverheadVariants } from './geometry/buildings/overheadProps';
import { GROUND_LAYERS } from './geometry/buildings/propBands';
import { stampZoneCategory, ZONE_CAT } from './geometry/buildings/parts';
import { ZoneType } from '../core/grid/types';
import { getInfraConfig, getInfraConfigById, getRotatedSize, isZoneBuilding, type InfraType, type Rotation } from '../core/building/InfraConfig';
import { getBuildingType } from '../core/building/types';
import { ViewMode, getFocusedStopKind } from '../core/ViewMode';
import { TRANSPORT_TO_INFRA_TYPE } from '../core/transport/TransportPlacement';
import { RESERVED_TO_ROTATION, MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../core/building/InfraPlacement';
import { getCivicPlan } from './geometry/civic/registry';
import { placeCivicPlan } from './geometry/civic/place';
import { disposeGroup } from './disposeGroup';
import { detailHidden } from './detailLOD';
import { InstancedLayer } from './InstancedLayer';
import { PALETTE } from '../ColorPalette';
import { ZONE_BLOCKER_COLORS, ACTIONABLE_BLOCKERS, type ZoneBlocker } from '../core/zone/ZoneBlocker';
import { UTILITY_WARNING_COLORS, type UtilityWarning, type WarnedCell } from '../core/building/BuildingUtilityWarning';

/** 桶的初始容量。滿了就倍增（見 InstancedLayer）。 */
const INITIAL_BUCKET_CAPACITY = 256;

/**
 * 把一份幾何整理成可以合併的樣子：套上世界矩陣、去索引、只留位置與法線。
 *
 * `mergeGeometries` 要求每一份的屬性集合**完全相同**，而且索引要嘛全都有、要嘛
 * 全都沒有。城裡的模型並不齊：有的帶 uv、有的不帶，有的是索引幾何、有的不是。
 * 原本只刪掉幾個已知的屬性就丟進去合併，於是只要城裡有一棟基礎設施，合併就回
 * null —— 而那時候真正的建築早就 `visible = false` 了，畫面上什麼都不剩
 * （BUG-270）。白模只要形狀，所以其餘屬性一律不留。
 */
function bakeForWhiteModel(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const clone = src.clone();
  let geo = clone;
  if (geo.index) {
    geo = geo.toNonIndexed();
    clone.dispose();
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  geo.applyMatrix4(matrix);
  return geo;
}


export class BuildingRenderer {
  // --- Persistent variant meshes (pre-allocated, never disposed until game exit) ---
  private zoneLayer = new InstancedLayer(getBuildingMaterial(), INITIAL_BUCKET_CAPACITY);
  /**
   * 地面物件層。與量體層平行，但**矩陣只含旋轉與位置** —— 沒有高度縮放
   * 也沒有基地縮放，所以樹在每個等級都是同一個真實尺寸（BUG-219）。
   */
  private propLayer = new InstancedLayer(getBuildingMaterial(), INITIAL_BUCKET_CAPACITY);
  /** 地面貼片層：建築腳下的鋪面。完全平，不投影。 */
  private decalLayer = new InstancedLayer(getBuildingMaterial(), INITIAL_BUCKET_CAPACITY);
  /** 懸挑層：雨遮、招牌、卸貨棚。挑到人行道上方，行人從下面走過。 */
  private overheadLayer = new InstancedLayer(getBuildingMaterial(), INITIAL_BUCKET_CAPACITY);

  /**
   * 掛在建築上的三層。
   *
   * 三者的實例矩陣完全相同（旋轉 + 位置，不吃任何縮放 —— 那是 BUG-219 的
   * 修法），差別只有幾何來源、基準高度與是否投影。列成表而不是寫三段幾乎
   * 一樣的程式碼：加桶、取位、退位、重置、釋放五個地方都要一致，漏掉任何
   * 一處就會留下孤兒實例，而畫面上只是「某一格的鋪面怪怪的」。
   */
  private readonly attachments: ReadonlyArray<{
    layer: InstancedLayer;
    variants: (zoneType: number, density: Density, level: number) => GeoBuilder[];
    castShadow: boolean;
    /**
     * 實例的基準高度。貼片是 0：它的幾何自己帶著絕對高度（鋪面與標線的
     * 層序必須留在幾何裡），再加一次就會把標線推離鋪面。
     */
    baseY: number;
    /**
     * 牆體是圓的就跳過這一層。
     *
     * 只有懸挑要跳：雨遮與招牌都是平板，貼在圓弧牆上會穿出去或懸空 ——
     * 與 BUG-226（雨遮貼在假想牆上）同一類，只是這次牆是彎的。矮物件站在
     * 地上，牆彎不彎與它無關；鋪面更是完全在地面上。
     */
    skipWhenRound?: boolean;
  }> = [
    { layer: this.decalLayer, variants: getDecalVariants, castShadow: false, baseY: 0 },
    {
      layer: this.propLayer, variants: getGroundPropVariants,
      castShadow: true, baseY: GROUND_LAYERS.BUILDING,
    },
    {
      layer: this.overheadLayer, variants: getOverheadVariants,
      castShadow: true, baseY: GROUND_LAYERS.BUILDING, skipWhenRound: true,
    },
  ];

  private variantInitialized = false;

  /** 既有測試與內部程式碼從這兩個名字讀狀態。實體在 zoneLayer 裡。 */
  private get variantMeshes(): ReadonlyMap<string, THREE.InstancedMesh> {
    return this.zoneLayer.bucketMap;
  }
  private get positionToInstance(): ReadonlyMap<string, { key: string; idx: number }> {
    return this.zoneLayer.entryMap;
  }

  // --- Non-persistent meshes (zone overlays, rebuilt each build) ---
  private overlayMeshes: THREE.InstancedMesh[] = [];
  private overlayIndex = new Map<string, { mesh: THREE.InstancedMesh; idx: number }>();

  // --- Infrastructure groups (now with index for lookup) ---
  private infraGroups: THREE.Group[] = [];
  private infraIndex = new Map<string, THREE.Group>();

  /** initVariantMeshes 收到的場景，重配時要用。 */
  private scene: THREE.Scene | null = null;

  // Light spot system (fake ground glow near buildings at night)
  private lightSpotMesh: THREE.InstancedMesh | null = null;
  private lightSpotMaterial: THREE.MeshBasicMaterial | null = null;
  private lightSpotPosToIdx = new Map<string, number>();
  private lightSpotIdxToPos: string[] = [];
  private lightSpotCount = 0;

  // Pre-allocated temp objects (avoid per-call allocation)
  private _matrix = new THREE.Matrix4();
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
    this.scene = scene;
    if (this.variantInitialized) return;
    this.variantInitialized = true;

    for (const zoneType of ZONE_TYPES) {
      const zoneCat = ZONE_CAT[zoneType] ?? 0;
      for (const density of ['LOW', 'HIGH'] as Density[]) {
        // 只有辦公區兩種密度都有建築；其餘分區各只有一種。
        if (!TARGET_HEIGHTS_M[heightKey(zoneType, density)]) continue;
        for (const level of LEVELS) {
          const variants = getMassingVariants(zoneType, density, level);
          for (let vi = 0; vi < variants.length; vi++) {
            const geo = variants[vi]!();
            stampZoneCategory(geo, zoneCat);
            this.zoneLayer.createBucket(scene, bucketKey(zoneType, density, level, vi), geo);
          }
          for (const a of this.attachments) {
            const builders = a.variants(zoneType, density, level);
            for (let pi = 0; pi < builders.length; pi++) {
              const geo = builders[pi]!();
              stampZoneCategory(geo, zoneCat);
              a.layer.createBucket(
                scene, bucketKey(zoneType, density, level, pi), geo,
                { castShadow: a.castShadow },
              );
            }
          }
        }
      }
    }
  }

  /**
   * 三個附掛層的實例矩陣：只有旋轉與位置。
   *
   * 沒有高度縮放也沒有基地縮放 —— 那正是 BUG-219 的修法。庭院跟著房子的
   * 朝向轉，所以樹籬永遠在同一面，但尺寸是真實的公尺，與等級無關；同一件事
   * 對鋪面與雨遮也成立（鋪面不會因為基地抖窄而縮水）。
   */
  private syncAttachments(
    x: number, y: number, zoneType: number, density: Density, level: number,
  ): void {
    if (!this.scene) return;

    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: VARIANT_COUNT,
      paletteSize: paletteFor(zoneType, level).length,
    });
    const rotation = (app.rotationQuarter * Math.PI) / 2;
    const round = isRoundBodied(zoneType, density, level, app.variantIndex);

    for (const a of this.attachments) {
      if (a.skipWhenRound && round) continue;
      const builders = a.variants(zoneType, density, level);
      if (builders.length === 0) continue;
      const pi = Math.floor(app.propVariant01 * builders.length) % builders.length;
      const slot = a.layer.acquire(
        this.scene, bucketKey(zoneType, density, level, pi), `${x},${y}`,
      );
      if (!slot) continue;

      this._matrix.makeRotationY(rotation);
      this._matrix.setPosition(x, a.baseY, y);
      slot.mesh.setMatrixAt(slot.idx, this._matrix);
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.grew) this._buildingMeshesDirty = true;

      // 新取到的位置可能留著上一個佔用者的值（swap-with-last 會搬資料），
      // 而招牌的亮暗吃這個值 —— 不清掉的話，剛蓋好的空屋會頂著前一戶的招牌
      // 亮著。實際比例由 updateOccupancy 在下一次補上。
      const occAttr = slot.mesh.geometry
        .getAttribute('aOccupancy') as THREE.InstancedBufferAttribute | undefined;
      if (occAttr) {
        (occAttr.array as Float32Array)[slot.idx] = 0;
        occAttr.needsUpdate = true;
      }
    }
  }

  /** 三個附掛層一起退位。建築消失時它們沒有理由留下。 */
  private releaseAttachments(posKey: string): void {
    for (const a of this.attachments) a.layer.release(posKey);
  }

  // ─── Incremental building operations ───────────────────────────

  /** Add a single zone building instance. */
  addBuilding(
    x: number, y: number, zoneType: number, density: Density,
    level: number, burned: boolean, abandoned = false,
  ): void {
    const variants = getMassingVariants(zoneType, density, level);
    if (variants.length === 0) return;

    const palette = paletteFor(zoneType, level);
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: variants.length, paletteSize: palette.length,
    });
    if (!this.scene) return; // 尚未 build，無處可加
    const key = bucketKey(zoneType, density, level, app.variantIndex);
    const slot = this.zoneLayer.acquire(this.scene, key, `${x},${y}`);
    if (!slot) return;

    this.setInstanceData(slot.mesh, slot.idx, x, y, zoneType, density, level, burned, abandoned);
    slot.mesh.instanceMatrix.needsUpdate = true;
    if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
    // 倍增會換掉 mesh 物件，highlight 的快取才需要重建。
    if (slot.grew) this._buildingMeshesDirty = true;

    this.syncAttachments(x, y, zoneType, density, level);

    // Sync lightSpot (non-burned, non-abandoned buildings emit light)
    if (!burned && !abandoned) this.addLightSpot(x, y);
  }

  /** Remove a single zone building instance (swap-with-last). */
  removeBuilding(x: number, y: number): void {
    this.zoneLayer.release(`${x},${y}`);
    this.releaseAttachments(`${x},${y}`);
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

    // 三層的組合都依等級而不同，所以升級必須換桶 —— 只改矩陣的話，L3 的
    // 房子會配著 L1 的素土院子。一律先退再取，比較等級反而多一份要維護的狀態。
    this.releaseAttachments(posKey);
    this.syncAttachments(x, y, zoneType, density, level);

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
      variantCount: VARIANT_COUNT,
      paletteSize: palette.length,
    });

    // 矩陣只有旋轉與位移。生成器產出的是最終尺寸，所以量體層與三個附掛層
    // 的矩陣完全一致 —— 那個 scale(±15%, ±10%, ±15%) 是 BUG-219 與 BUG-226
    // 的共同成因：附掛層的幾何是整桶共用的一份，看不到量體抖了多少。
    this._matrix.makeRotationY((app.rotationQuarter * Math.PI) / 2);
    this._matrix.setPosition(x, GROUND_LAYERS.BUILDING, y);
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
      // 樓層節奏由**變體**決定，不是逐格亂數：立面 shader 用它算窗戶橫列的
      // 間距，而量體的高度是「樓層數 × 樓高」。兩邊各自取值的話，最上面那一排
      // 窗會被屋頂切掉一半，而那不會有任何東西報錯。
      //
      // 副作用是有意的：同一變體的所有實例共用窗戶節奏與窗寬。同一個設計的
      // 建築本來就長一樣，變化該來自變體本身。
      const fh = floorHeightOf(zoneType, density, level, app.variantIndex);
      arr[idx * 3] = (fh - FLOOR_HEIGHT_UNITS.MIN)
        / (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN);
      arr[idx * 3 + 1] = app.facadeSeed[1];   // 相位仍然逐格
      arr[idx * 3 + 2] = app.facadeSeed[2];   // 材質偏好仍然逐格
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

  /**
   * 刻意伸到地面以下的基礎設施。
   *
   * 渡輪碼頭要伸進水裡（水面在 −0.2），把它壓到地面上等於讓碼頭浮在水面。
   * 這是唯一的例外，所以列舉而不是加旗標欄位。
   */
  /**
   * 把整組模型垂直對齊地面。
   *
   * 手寫的那一版有十七種的幾何底部寫在 0.05 —— 那是**路面**的高度，不是
   * 地面的高度，所以它們全部浮空 0.6 m（BUG-224，與分區建築同一個成因）。
   * `CivicPlan` 的幾何自己就貼著 `GROUND_LAYERS.BUILDING`，所以現在這裡
   * 量出來的位移是 0；留著是因為它擋的是「下一個模型又把底部寫錯」，
   * 而那種錯不會有任何東西報。
   *
   * **沒有例外。** 渡輪碼頭曾經是唯一伸進水裡的一種，而那一版在基地裡自己
   * 畫了港池；查過 `isShorePosition` 之後拿掉了 —— 它的定義就是「這一格是
   * 陸地，而且四鄰有一格是水」。碼頭蓋在陸地上，水在隔壁那一格。
   */
  private snapToGround(group: THREE.Group): void {
    const box = new THREE.Box3().setFromObject(group);
    if (!Number.isFinite(box.min.y)) return;
    group.position.y += GROUND_LAYERS.BUILDING - box.min.y;
  }

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
    this.snapToGround(group);

    group.userData['infraType'] = type;
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
    this.zoneLayer.reset();
    for (const a of this.attachments) a.layer.reset();

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
    this.zoneLayer.flush();
    for (const a of this.attachments) a.layer.flush();

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
      const count = Math.min(cells.length, INITIAL_BUCKET_CAPACITY);
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
      const count = Math.min(cells.length, INITIAL_BUCKET_CAPACITY);

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
      this.snapToGround(group);

      group.userData['infraType'] = inf.type;
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

  /**
   * 一棟公共建築的模型。
   *
   * 走 `CivicPlan` —— 與展示區**同一份幾何、同一個 shader**
   * （`placeCivicPlan`）。這裡原本是十九個手寫的 `buildXxx()`，實心
   * `BoxGeometry` 加 `MeshLambertMaterial`：沒有窗戶、沒有夜間亮窗、
   * 沒有自發光，整個檔案裡 `emissive` 出現 0 次（BUG-238）。兩條路各畫各的
   * 結果是同一棟建築在遊戲裡與展示區長得不一樣。
   *
   * 查不到 plan 的種類退回一個素方塊。目前十九種都有 plan，所以那條路走不到
   * —— 但它比 `undefined` 好：新增一種 `InfraType` 卻忘了畫，畫面上會是一個
   * 灰盒子而不是一片空地。
   */
  private buildModel(type: InfraType, group: THREE.Group): void {
    const plan = getCivicPlan(type);
    if (plan) {
      placeCivicPlan(plan, group);
      return;
    }
    this.buildCivicBuilding(group, 0, 0, type);
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

  /**
   * ── 十九個手寫的 `buildXxx()` 在這裡被刪掉了（約 1 700 行）。 ──
   *
   * 它們畫的是實心 `BoxGeometry` 加 `MeshLambertMaterial`：沒有窗戶、
   * 沒有夜間亮窗、沒有自發光 —— 整段裡 `emissive` 出現 0 次（BUG-238）。
   * 十九種全部改走 `CivicPlan` 之後這一段一個呼叫點都沒有了。
   *
   * 留著「以後可能用得到」是錯的：它們與 plan 各畫各的，而沒有人會去改
   * 一段跑不到的程式碼 —— 它只會停在被取代的那一天的樣子，然後在某次
   * 搜尋裡被誤認成現役的畫法。
   */

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

    this.lightSpotMesh = new THREE.InstancedMesh(geometry, this.lightSpotMaterial, INITIAL_BUCKET_CAPACITY);
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
    if (!this.lightSpotMesh || this.lightSpotCount >= INITIAL_BUCKET_CAPACITY) return;
    const posKey = `${x},${y}`;
    if (this.lightSpotPosToIdx.has(posKey)) return; // already exists

    const idx = this.lightSpotCount;
    this._matrix.identity();
    this._matrix.setPosition(x, GROUND_LAYERS.LIGHT_SPOT, y);
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

  /**
   * Update per-instance occupancy attribute from occupancy ratio map.
   *
   * **四層都要寫**，不只量體層。招牌與燈頭住在懸挑層與矮物件層，而它們的
   * 亮不亮吃的是同一個 `aOccupancy`（`PART_LAMP`）—— 只寫量體層的話，
   * 那兩層的值永遠停在 0，招牌與路燈整座城市都是暗的。
   */
  updateOccupancy(ratios: Map<string, number>): void {
    const layers = [this.zoneLayer, ...this.attachments.map(a => a.layer)];
    for (const layer of layers) {
      for (const [key, mesh] of layer.bucketMap) {
        const occAttr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
        if (!occAttr) continue;
        const arr = occAttr.array as Float32Array;
        const count = layer.countOf(key);
        for (let i = 0; i < count; i++) {
          const posKey = layer.posKeyAt(key, i);
          arr[i] = posKey ? (ratios.get(posKey) ?? 0) : 0;
        }
        occAttr.needsUpdate = true;
      }
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
  /** 縮到 DETAIL_LOD.HIDE_ABOVE 之外。與 `_focusMode` 各自獨立（見 applyLayerVisibility）。 */
  private _detailHidden = false;
  private _whiteModelMesh: THREE.Mesh | null = null;

  /**
   * 聚焦中的那一種站點不白模化 —— 玩家點進「公車」就是要看公車站在哪，
   * 把它跟其他建築一起漂白等於把要看的東西藏起來。
   */
  private _focusExemptType: InfraType | null = null;

  /** 這一組是聚焦中的站點嗎？隱藏與烘白模用的是同一個判斷。 */
  private isFocusExempt(group: THREE.Group): boolean {
    return this._focusExemptType !== null
      && group.userData['infraType'] === this._focusExemptType;
  }
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

  /**
   * 依鏡頭的縮放決定要不要畫矮物件與懸挑。每幀呼叫，成本是兩個比較。
   *
   * `frustumHeight` 是正交鏡頭的視錐高度（`camera.top - camera.bottom`），
   * 單位是格。門檻與遲滯的理由見 `DETAIL_LOD`。
   *
   * 地面貼片不在內：它是平的鋪面，撐住「地面有東西」的觀感，關掉會讓遠景
   * 整片地變空，工業區那塊柏油也會跟著消失。
   */
  updateDetailLOD(frustumHeight: number): void {
    const hidden = detailHidden(frustumHeight, this._detailHidden);
    if (hidden === this._detailHidden) return;
    this._detailHidden = hidden;
    this.applyLayerVisibility();
  }

  /**
   * 把兩個獨立的閘門解析成三個附掛層的顯示狀態。
   *
   * 檢視模式與縮放是兩件事，任一方直接設 `visible` 都會踩到對方 ——
   * 離開白模檢視時把三層設回 true，縮在遠景的鏡頭就會突然長回矮物件，
   * 而使用者從頭到尾沒有動過滾輪。
   */
  private applyLayerVisibility(): void {
    this.decalLayer.setVisible(!this._focusMode);
    const detail = !this._focusMode && !this._detailHidden;
    this.propLayer.setVisible(detail);
    this.overheadLayer.setVisible(detail);
  }

  /** Switch view mode — any non-NORMAL mode shows white model. */
  setViewMode(mode: ViewMode, scene?: THREE.Scene): void {
    const enabled = mode !== ViewMode.NORMAL;
    this._focusMode = enabled;
    const kind = getFocusedStopKind(mode);
    this._focusExemptType = kind ? TRANSPORT_TO_INFRA_TYPE[kind] : null;
    // 三個附掛層以前完全沒被 setViewMode 碰過，也沒有烘進白模，所以貼片、
    // 樹與招牌會維持原色浮在白模上面（BUG-232）。
    this.applyLayerVisibility();

    if (enabled && scene) {
      // Hide originals
      for (const mesh of this.variantMeshes.values()) mesh.visible = false;
      for (const mesh of this.overlayMeshes) mesh.visible = false;
      for (const group of this.infraGroups) group.visible = this.isFocusExempt(group);
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
      const count = mesh.count;
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, mat4);
        geos.push(bakeForWhiteModel(mesh.geometry, mat4));
      }
    }

    // Bake infra group meshes
    for (const group of this.infraGroups) {
      if (this.isFocusExempt(group)) continue;
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.updateWorldMatrix(true, false);
          geos.push(bakeForWhiteModel(child.geometry, child.matrixWorld));
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
    this.zoneLayer.dispose(scene);
    for (const a of this.attachments) a.layer.dispose(scene);
    this.variantInitialized = false;
  }
}

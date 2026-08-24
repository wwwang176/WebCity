/**
 * The building showcase. It does not load the game: no simulation, no workers, no UI panels.
 *
 * It deliberately uses the real SceneManager, the real materials and the real variant registry.
 * Whatever is tuned to satisfaction here has to look identical in game, or the showcase has no
 * value.
 */
import * as THREE from 'three';
import { SceneManager } from '../renderer/SceneManager';
import { WeatherRenderer } from '../renderer/WeatherRenderer';
import { Season } from '../core/climate/Climate';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { TRIANGLE_BUDGET } from '../renderer/geometry/buildings/registry';
import { getMassingVariants, VARIANT_COUNT, isRoundBodied } from '../renderer/geometry/buildings/massing';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../renderer/geometry/buildings/parts';
import { getGroundPropVariants } from '../renderer/geometry/buildings/groundProps';
import { getDecalVariants } from '../renderer/geometry/buildings/decals';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../renderer/geometry/buildings/overheadProps';
import { GROUND_LAYERS } from '../renderer/geometry/buildings/propBands';
import type { GeoBuilder, Density } from '../renderer/geometry/buildings/registry';
import { ZoneType } from '../core/grid/types';
import {
  blockCells, matrixCells, neighbourSameRatio,
  type PlacedCell, type ViewMode,
} from './views';
import { stampInstanceValues, floorRhythm01, type InstanceValues } from '../renderer/geometry/civic/instanceAttrs';
import { createShowcaseGround } from './ground';
import { DetailVisibility } from './detailVisibility';
import { appearanceOf } from '../renderer/BuildingAppearance';
import { mountControls, type ControlState } from './controls';
import { attachCameraInput } from './cameraInput';
import { placeCivic, civicTriangleReport, allMeshes, type CivicTris } from './civic';
import { createShowcaseTrack } from './track';
import { civicLayout, civicLayoutExtent } from './civicLayout';
import { ShowcasePlanes, type PlaneField } from './planes';
import { getCivicPlan, civicTypesDone } from '../renderer/geometry/civic/registry';
import { getInfraConfig } from '../core/building/InfraConfig';

const container = document.getElementById('scene')!;
const sceneManager = new SceneManager(container);

/** The showcase floor. Its colour and lighting model follow the game's terrain; see `createShowcaseGround`. */
sceneManager.scene.add(createShowcaseGround(120));

// The day-night cycle runs through the real WeatherRenderer: the shader reads the scene lights
// (directionalLights[0]) rather than uTime, so without it the time slider is not connected.
const weather = new WeatherRenderer(sceneManager, 60);

const material = getBuildingMaterial();
const shown: THREE.Mesh[] = [];
/**
 * The objects that are not meshes, currently only the track under the train station.
 *
 * The `shown` path calls `scene.remove(m)` and then disposes the geometry, and `remove` only works
 * on **direct children**: passing a group's child leaves an empty shell in the scene, and the next
 * draw stacks another one on top.
 */
const shownGroups: THREE.Object3D[] = [];

/**
 * Ground props and overhangs are switched off at distance, on the same thresholds as the game (see
 * `renderer/detailLOD`).
 *
 * The game gates whole `InstancedLayer`s while the showcase draws plain meshes, so the two
 * implementations differ, but **the thresholds and the hysteresis are one shared copy**. Otherwise
 * the two show different things at some zoom levels, which is the one thing the showcase must never
 * do.
 */
const detailLOD = new DetailVisibility();

/**
 * The airport's arrival and departure animation.
 *
 * Aircraft animation is what makes the comparison possible: does the aircraft land on the runway,
 * follow the taxiway, park at the gate — all against the painted markings. It runs the **same**
 * `AirplaneAnimator` the game does.
 */
const planes = new ShowcasePlanes(sceneManager.scene);

/** `civicTypesDone()`'s type names mapped to the animator's airport sizes. */
const AIRPORT_SIZE_OF: Partial<Record<string, 'SMALL' | 'MEDIUM' | 'LARGE'>> = {
  airport_s: 'SMALL', airport_m: 'MEDIUM', airport_l: 'LARGE',
};

function clear(): void {
  planes.clear();
  for (const m of shown) {
    sceneManager.scene.remove(m);
    m.geometry.dispose();
  }
  shown.length = 0;
  for (const g of shownGroups) sceneManager.scene.remove(g);
  shownGroups.length = 0;
  detailLOD.clear();
}

/** One draw's triangle counts. The four layers are separate because each has its own budget and its own problems. */
interface Tris { massing: number; decal: number; prop: number; overhead: number }

/**
 * The three layers attached to a building, matching BuildingRenderer.attachments entry for entry.
 *
 * The layer with `baseY` 0, the decals, carries absolute heights in its geometry; the other two are
 * measured from the building's base.
 */
const ATTACHMENTS: ReadonlyArray<{
  variants: (zoneType: number, density: Density, level: number) => GeoBuilder[];
  enabled: () => boolean;
  castShadow: boolean;
  baseY: number;
  into: keyof Omit<Tris, 'massing'>;
  /** Whether the whole layer switches off at distance. Decals do not: they are flat paving, and switching them off empties the ground at a distance. */
  culled: boolean;
  /** Skipped where the body is round, matching the field of the same name in BuildingRenderer.attachments. */
  skipWhenRound?: boolean;
}> = [
  {
    variants: getDecalVariants, enabled: () => state.showDecals,
    castShadow: false, baseY: 0, into: 'decal', culled: false,
  },
  {
    variants: getGroundPropVariants, enabled: () => state.showLowProps,
    castShadow: true, baseY: GROUND_LAYERS.BUILDING, into: 'prop', culled: true,
  },
  {
    variants: getOverheadVariants, enabled: () => state.showOverhead,
    castShadow: true, baseY: GROUND_LAYERS.BUILDING, into: 'overhead', culled: true,
    skipWhenRound: true,
  },
];

/**
 * Places one building at (x, z) under exactly the game's transform, and returns each layer's
 * triangle count.
 *
 * The rotation is reproduced here; there is no scaling, as the generator emits final dimensions. The
 * showcase's only value is that what it shows is what ships, so the transform has to match the
 * game's.
 */
function place(cell: PlacedCell, seedByte: number): Tris {
  const tris: Tris = { massing: 0, decal: 0, prop: 0, overhead: 0 };
  const variants = getMassingVariants(cell.zoneType, cell.density, cell.level);
  if (variants.length === 0) return tris;
  const geo = variants[cell.variantIndex % variants.length]!();
  stampZoneCategory(geo, ZONE_CAT[cell.zoneType] ?? 0);

  const app = appearanceOf({
    x: cell.x, y: cell.z, zoneType: cell.zoneType, level: cell.level, seedByte,
    variantCount: VARIANT_COUNT, paletteSize: 8,
  });

  // The per-instance attributes. The game holds them on an InstancedBufferAttribute while the
  // showcase draws plain meshes: without filling them in, WebGL supplies 0 throughout, so facades
  // take the minimum floor height, every window's phase aligns, and occupancy = 0 tells the shader
  // nobody is home and not one light comes on.
  const values: InstanceValues = {
    occupancy: state.occupancy,
    seed: [
      floorRhythm01(cell.zoneType, cell.density, cell.level, cell.variantIndex),
      app.facadeSeed[1],
      app.facadeSeed[2],
    ],
  };
  stampInstanceValues(geo, values);

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // No scaling: the generator emits final dimensions.
  mesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
  mesh.position.set(cell.x, GROUND_LAYERS.BUILDING, cell.z);
  sceneManager.scene.add(mesh);
  shown.push(mesh);

  // Round towers carry no canopies or signs, since a flat panel does not sit on a curved wall. The
  // game applies the same rule.
  const round = isRoundBodied(cell.zoneType, cell.density, cell.level, cell.variantIndex);

  for (const a of ATTACHMENTS) {
    if (!a.enabled()) continue;
    if (a.skipWhenRound && round) continue;
    const builders = a.variants(cell.zoneType, cell.density, cell.level);
    if (builders.length === 0) continue;
    const pi = Math.floor(app.propVariant01 * builders.length) % builders.length;
    const pgeo = builders[pi]!();
    stampZoneCategory(pgeo, ZONE_CAT[cell.zoneType] ?? 0);
    // Signs and lamp heads (PART_LAMP) take their brightness from aOccupancy, so the attachment
    // layers need it too.
    stampInstanceValues(pgeo, values);
    const pmesh = new THREE.Mesh(pgeo, material);
    pmesh.castShadow = a.castShadow;
    pmesh.receiveShadow = true;
    // No scaling, which is exactly why these three layers exist (BUG-219).
    pmesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
    pmesh.position.set(cell.x, a.baseY, cell.z);
    sceneManager.scene.add(pmesh);
    shown.push(pmesh);
    // add() applies the current zoom state immediately. Zoomed out, touching a control redraws
    // everything, and without this step all the detail comes back.
    if (a.culled) detailLOD.add(pmesh);
    tris[a.into] = triangleCount(pgeo);
  }

  tris.massing = triangleCount(geo);
  return tris;
}

const state: ControlState = {
  mode: 'block', zoneType: ZoneType.RESIDENTIAL_LOW, level: 1,
  density: 'LOW', seedByte: 0, timeOverride: 0.3, occupancy: 0.85,
  wireframe: false, blockSize: 8,
  showDecals: true, showLowProps: true, showOverhead: true,
  variantOverride: null,
};

/** The table's four layers, named to match `CivicTris`' keys entry for entry. */
const CIVIC_LAYER_LABELS: Array<[string, keyof CivicTris]> = [
  ['量體', 'massing'], ['貼片', 'decal'], ['矮物件', 'prop'], ['懸挑', 'overhead'],
];

/**
 * The civic buildings view, which draws **all of them at once**.
 *
 * Switching through them one at a time hides the relationships among the nineteen, and whether the
 * colours separate, whether the height differences are reasonable and whether the street furniture's
 * density is consistent are exactly what needs reviewing.
 *
 * It is separate from the zoned-building flow below because the two share almost nothing: no
 * variants, no levels, no blocks, and a budget counted per cell. Forcing them through one path only
 * fills both with conditionals.
 */
function renderCivic(fitCamera: boolean): void {
  const stats = document.getElementById('stats');
  const slots = civicLayout(civicTypesDone());
  if (slots.length === 0) {
    if (stats) stats.innerHTML = '還沒有任何公共建築改造完成。<br>（見 BUG-238）';
    return;
  }

  const rows: string[] = [];
  const total: CivicTris = { massing: 0, decal: 0, prop: 0, overhead: 0 };
  const fields: PlaneField[] = [];

  for (const slot of slots) {
    const plan = getCivicPlan(slot.type);
    if (!plan) continue;
    const placed = placeCivic(plan, sceneManager.scene, state.occupancy, slot);
    shown.push(...allMeshes(placed));
    // add() applies the current zoom state immediately. Zoomed out, touching a control redraws
    // everything, and without this step all the detail comes back.
    for (const m of placed.culled) detailLOD.add(m);

    // The **real** track under the train station. A station is built on track
    // (`canPlaceTransportStop` requires `railType != 0`), so in game the rails do run through the
    // middle of it — what the showcase lacks is `TrackRenderer`, not a cell in this drawing.
    if (slot.type === 'train_station') {
      const track = createShowcaseTrack(slot);
      sceneManager.scene.add(track);
      shownGroups.push(track);
    }

    const size = AIRPORT_SIZE_OF[slot.type];
    if (size) fields.push({ size, x: slot.x, z: slot.z });

    const cfg = getInfraConfig(slot.type);
    const report = civicTriangleReport(plan.footprint, placed.tris);
    const cells = Object.entries(placed.tris).reduce((a, [, v]) => a + v, 0);
    for (const key of ['massing', 'decal', 'prop', 'overhead'] as const) {
      total[key] += placed.tris[key];
    }
    // Only the layers over budget are listed. All four for each of nineteen buildings is 76 rows,
    // and the one over budget drowns in them — making it stand out is why the table exists.
    const over = CIVIC_LAYER_LABELS
      .filter(([, key]) => report.over[key])
      .map(([label, key]) =>
        `<span class="over">${label} ${placed.tris[key]}／${report.budget[key]}</span>`);
    rows.push(
      `${cfg?.name ?? slot.type}（${report.cells} 格）${cells} 三角形`
      + (over.length > 0 ? `　${over.join('　')}` : ''),
    );
  }

  planes.setFields(fields);

  sceneManager.setCameraTarget(0, 0);
  // Framed once, **only on entering the mode**. Framing on every redraw pulls the user's own zoom
  // back the moment they touch the occupancy slider.
  if (fitCamera) {
    const ext = civicLayoutExtent(slots);
    // In an isometric view a w by h plot occupies roughly the sum of its two axis projections on
    // screen. The 1.15 leaves a margin: fitted exactly, the outermost building touches the edge.
    const want = (ext.w + ext.h) * 0.62 * 1.15;
    sceneManager.zoomCamera(want - (sceneManager.camera.top - sceneManager.camera.bottom));
  }

  if (stats) {
    const sum = Object.values(total).reduce((a, b) => a + b, 0);
    stats.innerHTML =
      `${slots.length} 種公共建築｜共 ${sum} 三角形<br>`
      + CIVIC_LAYER_LABELS.map(([label, key]) => `${label} ${total[key]}`).join('　')
      + `<br>` + rows.join('<br>')
      + `<br><span id="fps">—</span>`;
  }
}

/** The mode of the previous draw, used only to tell whether civic was just entered so the camera is framed once. */
let lastMode: ViewMode | null = null;

function render(): void {
  clear();
  material.wireframe = state.wireframe;

  if (state.mode === 'civic') {
    renderCivic(lastMode !== 'civic');
    lastMode = state.mode;
    return;
  }
  lastMode = state.mode;

  let cells: PlacedCell[];
  if (state.mode === 'single') {
    cells = [{
      x: 0, z: 0, zoneType: state.zoneType, density: state.density, level: state.level,
      variantIndex: state.variantOverride ?? 0, facadeSeed: [0.5, 0.5, 0.5],
    }];
  } else if (state.mode === 'block') {
    cells = blockCells(state.zoneType, state.density, state.level, state.blockSize, state.seedByte);
  } else {
    cells = matrixCells();
  }

  const total: Tris = { massing: 0, decal: 0, prop: 0, overhead: 0 };
  for (const c of cells) {
    const t = place(c, state.seedByte);
    total.massing += t.massing;
    total.decal += t.decal;
    total.prop += t.prop;
    total.overhead += t.overhead;
  }

  // Centred on the content: the matrix mode's content lies wholly in the positive quadrant, out of
  // sight of a camera aimed at the origin.
  if (cells.length > 0) {
    const cx = (Math.min(...cells.map(c => c.x)) + Math.max(...cells.map(c => c.x))) / 2;
    const cz = (Math.min(...cells.map(c => c.z)) + Math.max(...cells.map(c => c.z))) / 2;
    sceneManager.setCameraTarget(cx, cz);
  }

  const ratio = state.mode === 'block' ? neighbourSameRatio(cells) : 0;
  const n = Math.max(1, cells.length);
  const sum = total.massing + total.decal + total.prop + total.overhead;

  // A budget per layer: massing and ground props have stated limits, while the decal and overhead
  // limits live in their own modules. A field with no limit is left uncoloured rather than measured
  // against someone else's.
  const rows: Array<[string, number, number | null]> = [
    ['量體', total.massing, state.level === 3 ? TRIANGLE_BUDGET.TOWER : TRIANGLE_BUDGET.HOUSE],
    ['貼片', total.decal, null],
    ['矮物件', total.prop, TRIANGLE_BUDGET.PROP],
    ['懸挑', total.overhead, OVERHEAD_TRIANGLE_BUDGET],
  ];

  const stats = document.getElementById('stats');
  if (stats) {
    stats.innerHTML =
      `${cells.length} 棟<br>`
      + rows.map(([label, tris, budget]) => {
        const per = Math.round(tris / n);
        const over = budget !== null && per > budget;
        const cap = budget === null ? '' : `（上限 ${budget}）`;
        return `<span class="${over ? 'over' : ''}">${label} ${per} 三角形／棟${cap}</span>`;
      }).join('<br>')
      + `<br>總計 ${sum} 三角形<br>`
      + `變體 ${VARIANT_COUNT} 種｜相鄰同變體 `
      + `<span class="${ratio > 0.05 ? 'over' : ''}">${(ratio * 100).toFixed(1)}%</span>`
      + `（改造前 33.4%）<br>`
      + `<span id="fps">—</span>`;
  }
}

attachCameraInput(sceneManager.getCanvas(), sceneManager);
mountControls(document.getElementById('panel')!, state, render);
render();

let elapsed = 0;
let frames = 0;
let fpsClock = 0;
sceneManager.onUpdate((dt) => {
  elapsed += dt;
  // uTime drives only the random period of the window lights and always follows real time.
  material.uniforms.uTime!.value = elapsed;

  detailLOD.update(sceneManager.camera.top - sceneManager.camera.bottom);
  // Aircraft have something to run only in civic mode: `clear()` has already removed the airport,
  // and running here otherwise is idle work.
  planes.update(dt);

  if (state.timeOverride === null) {
    weather.update(dt, 1, Season.SUMMER);
  } else if (Math.abs(weather.dayFraction - state.timeOverride) > 1e-6) {
    weather.setDayFraction(state.timeOverride);
  }

  frames++;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    const el = document.getElementById('fps');
    if (el) el.textContent = `${Math.round(frames / fpsClock)} fps`;
    frames = 0;
    fpsClock = 0;
  }
});
sceneManager.start();

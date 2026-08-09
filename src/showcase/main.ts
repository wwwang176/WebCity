/**
 * 建築展示區 —— 不載入遊戲：沒有模擬、沒有 worker、沒有 UI 面板。
 *
 * 它刻意使用正式的 SceneManager、正式的材質與正式的變體註冊表。
 * 在這裡調到滿意的東西，進遊戲必須長得一模一樣，否則展示區沒有價值。
 */
import * as THREE from 'three';
import { SceneManager } from '../renderer/SceneManager';
import { WeatherRenderer } from '../renderer/WeatherRenderer';
import { Season } from '../core/climate/Climate';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { TRIANGLE_BUDGET } from '../renderer/geometry/buildings/registry';
import { getMassingVariants, VARIANT_COUNT } from '../renderer/geometry/buildings/massing';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../renderer/geometry/buildings/parts';
import { getGroundPropVariants } from '../renderer/geometry/buildings/groundProps';
import { getDecalVariants } from '../renderer/geometry/buildings/decals';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../renderer/geometry/buildings/overheadProps';
import { GROUND_LAYERS } from '../renderer/geometry/buildings/propBands';
import type { GeoBuilder, Density } from '../renderer/geometry/buildings/registry';
import { ZoneType } from '../core/grid/types';
import { blockCells, matrixCells, neighbourSameRatio, type PlacedCell } from './views';
import { appearanceOf } from '../renderer/BuildingAppearance';
import { mountControls, type ControlState } from './controls';
import { attachCameraInput } from './cameraInput';

const container = document.getElementById('scene')!;
const sceneManager = new SceneManager(container);

/** 展示用地面，讓建築不是浮在虛空中。 */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshLambertMaterial({ color: 0x3a4a3a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
sceneManager.scene.add(ground);

// 日夜由正式的 WeatherRenderer 驅動 —— shader 讀的是場景燈光
// (directionalLights[0])，不是 uTime，所以少了它時間滑桿等於沒接。
const weather = new WeatherRenderer(sceneManager, 60);

const material = getBuildingMaterial();
const shown: THREE.Mesh[] = [];

function clear(): void {
  for (const m of shown) {
    sceneManager.scene.remove(m);
    m.geometry.dispose();
  }
  shown.length = 0;
}

/** 一次繪製的三角形統計。四層各自一格，因為它們各有各的預算與問題。 */
interface Tris { massing: number; decal: number; prop: number; overhead: number }

/**
 * 掛在建築上的三層 —— 與 BuildingRenderer.attachments 逐項對應。
 *
 * `baseY` 為 0 的那一層（貼片）幾何自己帶著絕對高度；另外兩層從建築底面起算。
 */
const ATTACHMENTS: ReadonlyArray<{
  variants: (zoneType: number, density: Density, level: number) => GeoBuilder[];
  enabled: () => boolean;
  castShadow: boolean;
  baseY: number;
  into: keyof Omit<Tris, 'massing'>;
}> = [
  {
    variants: getDecalVariants, enabled: () => state.showDecals,
    castShadow: false, baseY: 0, into: 'decal',
  },
  {
    variants: getGroundPropVariants, enabled: () => state.showLowProps,
    castShadow: true, baseY: GROUND_LAYERS.BUILDING, into: 'prop',
  },
  {
    variants: getOverheadVariants, enabled: () => state.showOverhead,
    castShadow: true, baseY: GROUND_LAYERS.BUILDING, into: 'overhead',
  },
];

/**
 * 放一棟建築在 (x, z)，套用與遊戲完全相同的變換。回傳各層的三角形數。
 *
 * 旋轉必須在這裡重現，縮放則已經不存在 —— 生成器直接產出最終尺寸（2C-1）。
 * 「展示區看到的就是出貨的東西」是它唯一的價值，所以變換必須與遊戲一致。
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

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // 不套用任何縮放 —— 生成器產出的就是最終尺寸（階段 2C-1）。
  mesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
  mesh.position.set(cell.x, GROUND_LAYERS.BUILDING, cell.z);
  sceneManager.scene.add(mesh);
  shown.push(mesh);

  for (const a of ATTACHMENTS) {
    if (!a.enabled()) continue;
    const builders = a.variants(cell.zoneType, cell.density, cell.level);
    if (builders.length === 0) continue;
    const pi = Math.floor(app.propVariant01 * builders.length) % builders.length;
    const pgeo = builders[pi]!();
    stampZoneCategory(pgeo, ZONE_CAT[cell.zoneType] ?? 0);
    const pmesh = new THREE.Mesh(pgeo, material);
    pmesh.castShadow = a.castShadow;
    pmesh.receiveShadow = true;
    // 不套用任何縮放 —— 這正是這三層存在的理由（BUG-219）。
    pmesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
    pmesh.position.set(cell.x, a.baseY, cell.z);
    sceneManager.scene.add(pmesh);
    shown.push(pmesh);
    tris[a.into] = triangleCount(pgeo);
  }

  tris.massing = triangleCount(geo);
  return tris;
}

const state: ControlState = {
  mode: 'block', zoneType: ZoneType.RESIDENTIAL_LOW, level: 1,
  density: 'LOW', seedByte: 0, timeOverride: 0.3, wireframe: false, blockSize: 8,
  showDecals: true, showLowProps: true, showOverhead: true,
};

function render(): void {
  clear();
  material.wireframe = state.wireframe;

  let cells: PlacedCell[];
  if (state.mode === 'single') {
    cells = [{
      x: 0, z: 0, zoneType: state.zoneType, density: state.density, level: state.level,
      variantIndex: 0, facadeSeed: [0.5, 0.5, 0.5],
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

  // 依內容置中：矩陣模式的內容全在正象限，預設鏡頭對著原點會看不到。
  if (cells.length > 0) {
    const cx = (Math.min(...cells.map(c => c.x)) + Math.max(...cells.map(c => c.x))) / 2;
    const cz = (Math.min(...cells.map(c => c.z)) + Math.max(...cells.map(c => c.z))) / 2;
    sceneManager.setCameraTarget(cx, cz);
  }

  const ratio = state.mode === 'block' ? neighbourSameRatio(cells) : 0;
  const n = Math.max(1, cells.length);
  const sum = total.massing + total.decal + total.prop + total.overhead;

  // 四層各自的預算：量體與矮物件有明訂上限，貼片與懸挑各自的上限寫在自己的
  // 模組裡。沒有上限的欄位就不上色，而不是拿別人的上限硬套。
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
      + `相鄰相同 ${(ratio * 100).toFixed(1)}%<br>`
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
  // uTime 只驅動窗戶亮燈的隨機週期，一律照實時走。
  material.uniforms.uTime!.value = elapsed;

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

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
import { getVariants, TRIANGLE_BUDGET } from '../renderer/geometry/buildings/registry';
import { stampZoneCategory, ZONE_CAT } from '../renderer/geometry/buildings/parts';
import { ZoneType } from '../core/grid/types';
import { blockCells, matrixCells, neighbourSameRatio, type PlacedCell } from './views';
import { appearanceOf } from '../renderer/BuildingAppearance';
import { heightScaleFor, type Density } from '../renderer/geometry/buildings/registry';
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

/**
 * 放一棟建築在 (x, z)，套用與遊戲完全相同的變換。回傳三角形數。
 *
 * 縮放與旋轉必須在這裡重現：BuildingRenderer 的高度不是幾何本身的高度，
 * 而是乘在幾何上的縮放係數。少了它，展示區顯示的比例與遊戲不同，
 * 而「展示區看到的就是出貨的東西」正是它唯一的價值。
 */
function place(cell: PlacedCell, seedByte: number): number {
  const variants = getVariants(cell.zoneType, cell.level);
  if (variants.length === 0) return 0;
  const geo = variants[cell.variantIndex % variants.length]!();
  stampZoneCategory(geo, ZONE_CAT[cell.zoneType] ?? 0);

  const app = appearanceOf({
    x: cell.x, y: cell.z, zoneType: cell.zoneType, level: cell.level, seedByte,
    variantCount: variants.length, paletteSize: 8,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
  mesh.scale.set(app.widthScale,
    heightScaleFor(cell.zoneType, cell.density, cell.level, app.variantIndex) * app.heightScale,
    app.depthScale);
  mesh.position.set(cell.x, 0.05, cell.z);
  sceneManager.scene.add(mesh);
  shown.push(mesh);
  return geo.getAttribute('position').count / 3;
}

const state: ControlState = {
  mode: 'block', zoneType: ZoneType.RESIDENTIAL_LOW, level: 1,
  density: 'LOW', seedByte: 0, timeOverride: 0.3, wireframe: false, blockSize: 8,
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

  let triangles = 0;
  for (const c of cells) {
    triangles += place(c, state.seedByte);
  }

  // 依內容置中：矩陣模式的內容全在正象限，預設鏡頭對著原點會看不到。
  if (cells.length > 0) {
    const cx = (Math.min(...cells.map(c => c.x)) + Math.max(...cells.map(c => c.x))) / 2;
    const cz = (Math.min(...cells.map(c => c.z)) + Math.max(...cells.map(c => c.z))) / 2;
    sceneManager.setCameraTarget(cx, cz);
  }

  const ratio = state.mode === 'block' ? neighbourSameRatio(cells) : 0;
  const budget = state.level === 3 ? TRIANGLE_BUDGET.TOWER : TRIANGLE_BUDGET.HOUSE;
  const perBuilding = cells.length > 0 ? Math.round(triangles / cells.length) : 0;

  const stats = document.getElementById('stats');
  if (stats) {
    stats.innerHTML =
      `${cells.length} 棟<br>`
      + `<span class="${perBuilding > budget ? 'over' : ''}">`
      + `${perBuilding} 三角形／棟（上限 ${budget}）</span><br>`
      + `總計 ${triangles} 三角形<br>`
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

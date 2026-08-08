/**
 * 建築展示區 —— 不載入遊戲：沒有模擬、沒有 worker、沒有 UI 面板。
 *
 * 它刻意使用正式的 SceneManager、正式的材質與正式的變體註冊表。
 * 在這裡調到滿意的東西，進遊戲必須長得一模一樣，否則展示區沒有價值。
 */
import * as THREE from 'three';
import { SceneManager } from '../renderer/SceneManager';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { getVariants, TRIANGLE_BUDGET } from '../renderer/geometry/buildings/registry';
import { stampZoneCategory, ZONE_CAT } from '../renderer/geometry/buildings/parts';
import { ZoneType } from '../core/grid/types';
import { blockCells, matrixCells, neighbourSameRatio, type PlacedCell } from './views';
import { mountControls, type ControlState } from './controls';

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

const material = getBuildingMaterial();
const shown: THREE.Mesh[] = [];

function clear(): void {
  for (const m of shown) {
    sceneManager.scene.remove(m);
    m.geometry.dispose();
  }
  shown.length = 0;
}

/** 放一棟建築在 (x, z)。回傳它的三角形數。 */
function place(zoneType: number, level: number, variantIndex: number, x: number, z: number): number {
  const variants = getVariants(zoneType, level);
  if (variants.length === 0) return 0;
  const geo = variants[variantIndex % variants.length]!();
  stampZoneCategory(geo, ZONE_CAT[zoneType] ?? 0);

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x, 0.05, z);
  sceneManager.scene.add(mesh);
  shown.push(mesh);
  return geo.getAttribute('position').count / 3;
}

const state: ControlState = {
  mode: 'block', zoneType: ZoneType.RESIDENTIAL_LOW, level: 1,
  seedByte: 0, timeOverride: null, wireframe: false, blockSize: 8,
};

function render(): void {
  clear();
  material.wireframe = state.wireframe;

  let cells: PlacedCell[];
  if (state.mode === 'single') {
    cells = [{
      x: 0, z: 0, zoneType: state.zoneType, level: state.level,
      variantIndex: 0, facadeSeed: [0.5, 0.5, 0.5],
    }];
  } else if (state.mode === 'block') {
    cells = blockCells(state.zoneType, state.level, state.blockSize, state.seedByte);
  } else {
    cells = matrixCells();
  }

  let triangles = 0;
  for (const c of cells) {
    triangles += place(c.zoneType, c.level, c.variantIndex, c.x, c.z);
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

mountControls(document.getElementById('panel')!, state, render);
render();

let elapsed = 0;
let frames = 0;
let fpsClock = 0;
sceneManager.onUpdate((dt) => {
  elapsed += dt;
  material.uniforms.uTime!.value = state.timeOverride ?? elapsed;

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

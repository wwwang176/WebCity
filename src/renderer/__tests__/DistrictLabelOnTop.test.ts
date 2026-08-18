import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { getBuildingMaterial } from '../BuildingMaterial';
import { SCENE } from '../SceneManager';
import { Grid } from '../../core/grid/Grid';

/**
 * 分區的名稱標籤會被高樓蓋掉。
 *
 * 標籤的材質已經是 `depthTest: false` 了 —— 直覺上那就該永遠畫在最上面。不是的:
 * 關掉深度測試只保證它不會被**先畫**的東西擋住，擋不住**後畫**的東西塗回來。
 *
 * 而建築的材質是 `transparent: true`，跟標籤在同一條透明佇列裡，兩者的 `renderOrder`
 * 又都是 0，於是先後完全由 three.js 的深度排序決定 —— 而那個排序用的是**物件原點**
 * 的視空間深度，不是實際佔的範圍。整座城市是一個 InstancedMesh，原點在世界原點，
 * 所以它排在「地圖原點那麼遠」的位置:比原點更遠的標籤先畫，接著整座城市塗上去。
 *
 * 這解釋了為什麼地圖越大越明顯 —— 離原點越遠的那半邊，標籤全部被蓋掉。
 */

/**
 * 標籤是畫在 canvas 上再貼成貼圖的，而測試跑在 node 環境。
 *
 * 這裡只要「有沒有 sprite、排在哪裡」，貼圖的內容不重要 —— 給一個什麼都不做的
 * 2D context 就夠了。用 jsdom 反而不行:它的 `getContext('2d')` 沒有實作，回 null。
 */
const noop = (): void => {};
beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        font: '', textAlign: '', textBaseline: '', lineWidth: 0,
        strokeStyle: '', fillStyle: '', globalAlpha: 1,
        measureText: (t: string) => ({ width: t.length * 20 }),
        fillText: noop, strokeText: noop, beginPath: noop, moveTo: noop,
        arcTo: noop, closePath: noop, fill: noop,
      }),
    }),
  };
});
afterAll(() => { delete (globalThis as { document?: unknown }).document; });

const MAP = 200;

/**
 * three.js 實際的透明物件繪製順序。
 *
 * 抄的是 `WebGLRenderLists` 的 `reversePainterSortStable` 與 `projectObject` 裡
 * 算 `z` 的方式:物件**世界座標原點**投影後的 NDC z。用真的排序規則，才測得到
 * 「排序依位置而變」這件事 —— 只斷言 renderOrder 大小的話，等於把實作抄一遍。
 */
function transparentDrawOrder(scene: THREE.Scene, camera: THREE.Camera): THREE.Object3D[] {
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const projScreen = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix, camera.matrixWorldInverse,
  );
  const items: { obj: THREE.Object3D; renderOrder: number; z: number; id: number }[] = [];
  const v = new THREE.Vector3();
  scene.traverseVisible((obj) => {
    const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
    if (!mat || Array.isArray(mat) || !mat.transparent) return;
    v.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(projScreen);
    items.push({ obj, renderOrder: obj.renderOrder, z: v.z, id: obj.id });
  });
  items.sort((a, b) => {
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    if (a.z !== b.z) return b.z - a.z;   // 遠的先畫
    return a.id - b.id;
  });
  return items.map(i => i.obj);
}

/** 遊戲的等角正交相機，對準地圖中心，方位角自訂。 */
function isoCamera(angle = SCENE.CAMERA_ANGLE): THREE.OrthographicCamera {
  const f = SCENE.FRUSTUM_SIZE;
  const cam = new THREE.OrthographicCamera(-f, f, f / 2, -f / 2, SCENE.NEAR_CLIP, SCENE.FAR_CLIP);
  const d = SCENE.CAMERA_DISTANCE, e = SCENE.CAMERA_ELEVATION;
  const target = new THREE.Vector3(MAP / 2, 0, MAP / 2);
  cam.position.set(
    target.x + d * Math.cos(e) * Math.cos(angle),
    target.y + d * Math.sin(e),
    target.z + d * Math.cos(e) * Math.sin(angle),
  );
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * 場景裡會蓋到標籤的東西，兩種都要有 —— 它們的排序位置完全不同:
 *
 *  - 分區建築是一個 `InstancedMesh`，物件原點留在**世界原點**（地圖西北角），
 *    實例散在整張圖上。所以整座城市是用西北角的深度排序的。
 *  - 基礎設施是 `Group`，`position` 設在自己那一格（`BuildingRenderer` 的
 *    `group.position.set(centerX, 0, centerZ)`），照真實位置排序。
 */
function cityObjects(): THREE.Object3D[] {
  const mat = getBuildingMaterial();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 6, 1), mat, 4);
  const m = new THREE.Matrix4();
  ([[10, 10], [10, 190], [190, 10], [190, 190]] as const).forEach(([x, z], i) => {
    m.makeTranslation(x, 3, z); mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;

  const out: THREE.Object3D[] = [mesh];
  for (const [x, z] of [[40, 40], [160, 160]] as const) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 8, 3), mat));
    out.push(g);
  }
  return out;
}

/** 四個角落各一個分區 —— 不管相機朝哪，都有標籤落在城市原點的後面。 */
const CORNERS = [
  { x: 12, y: 12, name: 'Northwest', value: 20 },
  { x: 12, y: 188, name: 'Southwest', value: 40 },
  { x: 188, y: 12, name: 'Northeast', value: 60 },
  { x: 188, y: 188, name: 'Southeast', value: 80 },
];

function districtScene() {
  const scene = new THREE.Scene();
  const city = cityObjects();
  for (const o of city) scene.add(o);
  const renderer = new OverlayRenderer();
  renderer.setOverlay(
    OverlayType.DISTRICT, scene, new Grid(MAP, MAP),
    new Map(CORNERS.map(c => [`${c.x},${c.y}`, c.value])),
    undefined, CORNERS,
  );
  const labels = (renderer as unknown as { labelSprites: THREE.Sprite[] }).labelSprites;
  expect(labels.length, '標籤根本沒建起來，這支測試等於沒測').toBe(CORNERS.length);
  return { scene, labels };
}

describe('分區名稱要蓋在城市上面', () => {
  it('fixture sanity: buildings really are in the transparent queue', () => {
    // 建築如果是不透明的，它會在透明佇列之前整批畫完，標籤怎麼排都蓋得住 ——
    // 那樣這支測試就沒有意義了，要先知道。
    expect(getBuildingMaterial().transparent,
      '建築材質不再是 transparent —— 這支測試的前提沒了，去看它現在畫在哪一趟')
      .toBe(true);
  });

  it('should keep the label out of the depth test as well', () => {
    // 上面那條模擬的是**繪製順序**，看不到深度緩衝 —— 把 `depthTest` 打開它照樣
    // 全綠，但畫面上標籤會被先畫進深度的樓擋掉。順序與深度是兩道獨立的關卡，
    // 兩道都要過，所以這一條直接釘材質。
    const { labels } = districtScene();
    for (const l of labels) {
      expect(l.material.depthTest, '標籤會被深度緩衝裡的樓擋掉').toBe(false);
    }
  });

  it('should draw every label after the city, from every camera angle', () => {
    // 掃過一圈，不是只看預設角度:深度排序的結果隨相機轉動而變，預設角度剛好
    // 讓城市的原點（地圖西北角）排在最遠，標籤僥倖贏 —— 轉到 135° 就輸了。
    const { scene, labels } = districtScene();
    for (let turn = 0; turn < 8; turn++) {
      const deg = Math.round((turn / 8) * 360);
      const order = transparentDrawOrder(scene, isoCamera((turn / 8) * Math.PI * 2));
      const firstLabel = Math.min(...labels.map(l => order.indexOf(l)));
      const others = order.filter(o => !labels.includes(o as THREE.Sprite));
      expect(others.length, '場景裡沒有別的透明物件，這條測不出東西').toBeGreaterThan(0);
      const lastOther = Math.max(...others.map(o => order.indexOf(o)));
      expect(firstLabel, `相機轉到 ${deg}° 時，${order[lastOther]!.type} 畫在標籤後面把它塗掉了`)
        .toBeGreaterThan(lastOther);
    }
  });
});

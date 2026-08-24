import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { getBuildingMaterial } from '../BuildingMaterial';
import { SCENE } from '../SceneManager';
import { Grid } from '../../core/grid/Grid';

/**
 * District name labels are covered by tall buildings.
 *
 * The label material is already `depthTest: false`, which intuitively should keep it on top. It
 * does not: disabling the depth test only guarantees nothing drawn **earlier** covers it, and does
 * not stop something drawn **later** painting over it.
 *
 * The building material is `transparent: true` and shares the label's transparent queue, and with
 * both at `renderOrder` 0 the order falls entirely to three.js's depth sort — which uses an
 * **object's origin** in view space rather than the range it occupies. The whole city is one
 * InstancedMesh whose origin is the world origin, so it sorts as far away as the map's origin:
 * labels beyond that origin draw first and the whole city paints over them.
 *
 * That is why it worsens with map size: on the half further from the origin, every label is
 * covered.
 */

/**
 * Labels are drawn on a canvas and turned into a texture, and these tests run under node.
 *
 * Only whether a sprite exists and where it sorts matters here, not the texture's content, so a
 * do-nothing 2D context suffices. jsdom does not work: its `getContext('2d')` is unimplemented and
 * returns null.
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
 * three.js's actual draw order for transparent objects.
 *
 * It reproduces `WebGLRenderLists`'s `reversePainterSortStable` and how `projectObject` computes
 * `z`: an object's **world origin** projected to NDC z. Using the real sort rule is what makes "the
 * order changes with position" testable; asserting renderOrder values alone would copy the
 * implementation.
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
    if (a.z !== b.z) return b.z - a.z;   // far objects draw first
    return a.id - b.id;
  });
  return items.map(i => i.obj);
}

/** The game's isometric orthographic camera, aimed at the map's centre with a chosen azimuth. */
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
 * The things in the scene that can cover a label. Both kinds are needed, because they sort from
 * completely different places:
 *
 *  - Zoned buildings are one `InstancedMesh` whose object origin stays at the **world origin**, the
 *    map's north-west corner, with its instances spread across the map. So the whole city sorts by
 *    that corner's depth.
 *  - Infrastructure is a `Group` with `position` set to its own cell (`group.position.set(centerX,
 *    0, centerZ)` in `BuildingRenderer`) and sorts by its real location.
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

/** One district in each corner, so whichever way the camera faces some label sorts behind the city's origin. */
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
    // If the buildings were opaque they would draw in full before the transparent queue and cover
    // the labels whatever their order, which would leave this file meaningless — worth knowing
    // first.
    expect(getBuildingMaterial().transparent,
      '建築材質不再是 transparent —— 這支測試的前提沒了，去看它現在畫在哪一趟')
      .toBe(true);
  });

  it('should keep the label out of the depth test as well', () => {
    // The case above simulates the **draw order** and cannot see the depth buffer: turning
    // `depthTest` on leaves it green while on screen the labels are hidden by buildings already
    // written into depth. Order and depth are two independent gates and both have to pass, so this
    // pins the material directly.
    const { labels } = districtScene();
    for (const l of labels) {
      expect(l.material.depthTest, '標籤會被深度緩衝裡的樓擋掉').toBe(false);
    }
  });

  it('should draw every label after the city, from every camera angle', () => {
    // It sweeps a full circle rather than testing the default angle alone: the depth sort's result
    // changes as the camera turns, and at the default angle the city's origin, the map's north-west
    // corner, happens to sort furthest and the labels win by luck — at 135 degrees they lose.
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

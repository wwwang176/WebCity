import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleRenderer, type VehicleData } from '../VehicleRenderer';

/**
 * 看不到的車不要送進 GPU。
 *
 * 車輛的 mesh 全都設了 `frustumCulled = false` —— 對 `InstancedMesh` 來說那是
 * 對的（整組共用一個包圍盒，three.js 沒辦法逐台判斷），但代價是滿載的 2000 台
 * 每一台每一幀都要算頂點，即使鏡頭在城市的另一頭。一台車 120 個三角形，2000 台
 * 就是 24 萬，比整張場景其餘部分加起來還多。
 *
 * 剔除的判準是**鏡頭的視錐**，不是離鏡頭目標的固定距離。行人那邊用的是固定
 * 半徑 15（`cullPedestrians`），照抄的話鏡頭一拉遠，車就只出現在畫面中央一小圈
 * —— 那比原本的問題還糟。
 *
 * 剔除只發生在渲染端。模擬完全不知道有這回事：被剔掉的車照樣在跑、照樣佔位，
 * 只是不畫 —— 而它在畫面外，所以「一台車對著空白煞車」不會回來（BUG-262）。
 */

const ASPECT = 16 / 9;

/** 等角鏡頭，對準 `target`，視野高度 `frustumSize` 格。 */
function isoCamera(target: { x: number; z: number }, frustumSize: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(
    -frustumSize * ASPECT / 2, frustumSize * ASPECT / 2,
    frustumSize / 2, -frustumSize / 2,
    0.1, 2000,
  );
  const dist = 200;
  const elev = Math.PI / 5;
  const ang = Math.PI / 4;
  cam.position.set(
    target.x + dist * Math.cos(elev) * Math.cos(ang),
    dist * Math.sin(elev),
    target.z + dist * Math.cos(elev) * Math.sin(ang),
  );
  cam.lookAt(target.x, 0, target.z);
  cam.updateMatrixWorld(true);
  return cam;
}

function car(id: number, x: number, z: number): VehicleData {
  return { id, x, y: z, heading: 0, type: 'car', laneOffset: 0 };
}

/** 一片 n×n 的車陣，中心在 (cx, cz)，間距 1 格。 */
function block(idBase: number, cx: number, cz: number, n: number): VehicleData[] {
  const out: VehicleData[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push(car(idBase + i * n + j, cx - n / 2 + i, cz - n / 2 + j));
    }
  }
  return out;
}

function bodyMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.castShadow,
  );
}

function lightMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.renderOrder === 10,
  );
}

function effective(mesh: THREE.InstancedMesh): number {
  return Math.min(mesh.count, mesh.instanceMatrix.count);
}

function drawnCount(scene: THREE.Scene): number {
  return bodyMeshes(scene).reduce((n, m) => n + effective(m), 0);
}

/** 畫出來的每個實例的世界座標。 */
function drawnPositions(scene: THREE.Scene): Array<{ x: number; z: number }> {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: Array<{ x: number; z: number }> = [];
  for (const mesh of bodyMeshes(scene)) {
    for (let i = 0; i < effective(mesh); i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
}

function setup(): { scene: THREE.Scene; renderer: VehicleRenderer } {
  const scene = new THREE.Scene();
  const renderer = new VehicleRenderer();
  renderer.build(scene);
  return { scene, renderer };
}

describe('車輛的視錐剔除', () => {
  it('should draw everything when no camera has been set', () => {
    // 展示區與其他不帶鏡頭的呼叫端不能因為這條而少畫東西。
    const { scene, renderer } = setup();
    const list = [...block(1, 0, 0, 10), ...block(1000, 400, 400, 10)];
    renderer.update(list);
    expect(drawnCount(scene), '沒有鏡頭時就不該剔除').toBe(list.length);
  });

  it('should skip vehicles the camera cannot see', () => {
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const near = block(1, 0, 0, 6);
    const far = block(1000, 500, 500, 12);
    renderer.update([...near, ...far]);

    expect(drawnCount(scene), '畫面外的車還是送進去了').toBe(near.length);
  });

  it('should draw the vehicles it keeps at the right places', () => {
    // 跳過中間某幾台之後，剩下的必須連續地填回實例索引 —— 留洞的話會有車
    // 停在原點，或是某一台的矩陣被下一台蓋掉。
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const list = [
      car(1, 0, 0),
      car(2, 600, 600),   // 畫面外
      car(3, 2, 2),
      car(4, -700, 400),  // 畫面外
      car(5, -3, 1),
    ];
    renderer.update(list);

    const drawn = drawnPositions(scene);
    expect(drawn.length, '留下的台數不對').toBe(3);
    for (const p of drawn) {
      expect(Math.abs(p.x) < 10 && Math.abs(p.z) < 10,
        `畫在 (${p.x}, ${p.z}) —— 那不是任何一台看得見的車`).toBe(true);
    }
  });

  it('should reveal more vehicles as the camera zooms out', () => {
    // 這一條擋的是「照抄行人的固定半徑」。固定半徑下，拉遠鏡頭看到的台數
    // 完全不變 —— 畫面變大了，車卻只出現在中央一小圈。
    const { scene, renderer } = setup();
    const spread = block(1, 0, 0, 40);   // 40×40 格，遠大於任何一個視野

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 20));
    renderer.update(spread);
    const zoomedIn = drawnCount(scene);

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 60));
    renderer.update(spread);
    const zoomedOut = drawnCount(scene);

    expect(zoomedIn, '近景一台都沒看到').toBeGreaterThan(0);
    expect(zoomedIn, '近景反而全畫了 —— 根本沒有剔除').toBeLessThan(spread.length);
    expect(zoomedOut, '鏡頭拉遠卻沒有看到更多車').toBeGreaterThan(zoomedIn);
  });

  it('should follow the camera when it pans', () => {
    const { scene, renderer } = setup();
    const here = block(1, 0, 0, 6);
    const there = block(1000, 300, 300, 6);
    const list = [...here, ...there];

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    renderer.update(list);
    for (const p of drawnPositions(scene)) {
      expect(Math.abs(p.x) < 50, '鏡頭在原點卻畫了遠處那一片').toBe(true);
    }

    renderer.setCullCamera(isoCamera({ x: 300, z: 300 }, 40));
    renderer.update(list);
    const after = drawnPositions(scene);
    expect(after.length, '鏡頭移過去之後那一片沒有出現').toBe(there.length);
    for (const p of after) {
      expect(p.x > 250, '鏡頭移走了還在畫原點那一片').toBe(true);
    }
  });

  it('should keep a margin so vehicles do not pop at the screen edge', () => {
    // 剛好卡在邊界上的車要留著。視錐是**畫面**的邊界，而車有體積、還會投影
    // —— 邊界外一點點的車，它的影子可能落在畫面裡。
    const { scene, renderer } = setup();
    const cam = isoCamera({ x: 0, z: 0 }, 40);

    // 精確的畫面邊界：沿 +x 最後一個仍落在視錐裡的位置。這一段自己算，不問
    // 渲染器 —— 拿渲染器自己的判準當門檻的話，餘裕設成 0 也會是綠的。
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    const p = new THREE.Vector3();
    let edge = 0;
    for (let d = 0; d < 400; d++) {
      if (!frustum.containsPoint(p.set(d, 0, 0))) break;
      edge = d;
    }

    renderer.setCullCamera(cam);
    let kept = 0;
    for (let d = 0; d < 400; d++) {
      renderer.update([car(1, d, 0)]);
      if (drawnCount(scene) === 0) break;
      kept = d;
    }

    expect(edge, '這個視野下沿 +x 一台都看不到，測試本身有問題').toBeGreaterThan(0);
    expect(kept, '剛好切在畫面邊界上 —— 邊緣的車會突然消失').toBeGreaterThan(edge);
  });

  it('should light only the vehicles it draws', () => {
    // 頭尾燈的數量是照**全部**車算的話，剔除就白做了 —— 燈比車還多，而且
    // 多出來的那些畫在畫面外。
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const near = block(1, 0, 0, 6);
    const far = block(1000, 500, 500, 12);
    renderer.update([...near, ...far]);

    for (const mesh of lightMeshes(scene)) {
      expect(effective(mesh), '燈的數量沒有跟著剔除走').toBe(near.length);
    }
  });
});

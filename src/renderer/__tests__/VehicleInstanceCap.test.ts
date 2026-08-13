import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleRenderer, type VehicleData } from '../VehicleRenderer';
import { SIMULATION } from '../../core/simulation/SimulationConstants';

/**
 * 交到 `update()` 手上的車，一台都不准少畫。
 *
 * 渲染端的容量原本是逐車種 500，而模擬端的上限是**全部車種合計**
 * `VEHICLE_CAP_MAX`（2000）。通勤車有 80% 被歸類成 `car`，所以人口約 2400
 * 以上時 car 就會越過 500 —— 越過的那些照樣參與碰撞（`advanceEdgeVehicles`
 * 走的是 `traffic.vehicles`，與渲染完全無關），只是不畫。
 *
 * 畫面上的樣子是：一台車跟前車隔著一大段空白在煞車，過一兩秒那台看不見的車
 * 才憑空出現。`vehicles` 是就地壓縮的，順序等於生成順序，所以剛生成的車排在
 * 陣列尾端 —— 它要等前面夠多台抵達退場，索引降到 500 以下才會被畫出來。
 *
 * 行人那邊沒有這個問題：`PedestrianRenderer` 的 `maxCount` 就是
 * `PEDESTRIAN.MAX_ACTIVE`，兩邊對齊。
 */

function cars(n: number): VehicleData[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x: i * 0.5,
    y: 0,
    heading: 0,
    type: 'car' as const,
    laneOffset: 0,
  }));
}

/** 車身那幾層：走車輛材質、會投影。頭尾燈是 `MeshBasicMaterial` 且不投影。 */
function bodyMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.castShadow,
  );
}

/** 頭尾燈那兩層：加色混合、不投影，靠 `renderOrder` 壓在車身之上。 */
function lightMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.renderOrder === 10,
  );
}

/**
 * 這個 mesh 真正畫得出來的實例數。
 *
 * 不是 `mesh.count` —— 那個值程式無條件就寫進去了，即使超過
 * `instanceMatrix` 裝得下的量。超出的部分 `setMatrixAt` 寫不進去（型別陣列
 * 對越界的索引是靜靜地丟掉），畫出來的是空的矩陣。看 `count` 的話，容量不
 * 夠的錯誤會照樣通過。
 */
function effective(mesh: THREE.InstancedMesh): number {
  return Math.min(mesh.count, mesh.instanceMatrix.count);
}

function drawnCount(scene: THREE.Scene): number {
  return bodyMeshes(scene).reduce((n, m) => n + effective(m), 0);
}

/** 場景裡有沒有哪個實例畫在 x 這個位置上。 */
function drawnAt(scene: THREE.Scene, x: number): boolean {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const mesh of bodyMeshes(scene)) {
    for (let i = 0; i < effective(mesh); i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.x - x) < 1e-6) return true;
    }
  }
  return false;
}

describe('車輛的實例容量', () => {
  it('should draw every car handed to it, past the old 500 cap', () => {
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    expect(drawnCount(scene), '有車被靜靜地丟掉了').toBe(list.length);
  });

  it('should draw the newest car, not just the first 500', () => {
    // 丟掉的是**陣列尾端**那些，也就是最新生成的那幾台 —— 光看總數會以為
    // 只是少了幾台無關緊要的，實際上少的正好是剛上路的那一台。
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    expect(drawnAt(scene, list[699]!.x), '最後生成的那台車沒有被畫出來').toBe(true);
  });

  it('should hold every vehicle the simulation can put on the road', () => {
    // 模擬端的上限是全部車種合計，而車種分佈完全由城市決定 —— 極端情況下
    // 這 2000 台可以全部是同一種。渲染端的容量若寫死在某個比它小的數字，
    // 就一定有城市會撞上。
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(SIMULATION.VEHICLE_CAP_MAX);
    renderer.update(list);

    expect(drawnCount(scene), '撞到模擬端的車輛上限就開始漏車').toBe(list.length);
  });

  it('should light every car it draws', () => {
    // 頭尾燈是一整批共用一個 mesh 的，容量與車身各算各的 —— 車身擴了燈沒擴的話，
    // 夜裡會有一整批車沒有頭燈，而白天完全看不出來（燈的 opacity 是 0）。
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    for (const mesh of lightMeshes(scene)) {
      expect(effective(mesh), '有車沒有燈').toBe(list.length);
    }
  });

  it('should grow the airplane tail and nav lights with the fleet', () => {
    // 尾翼與航行燈是另外兩個 mesh，逐架從主機身抄矩陣過去。主機身擴了它們
    // 沒擴的話，多出來的那些飛機會少一片垂直尾翼。
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const planes: VehicleData[] = Array.from({ length: 700 }, (_, i) => ({
      id: i + 1, x: i * 0.5, y: 0, heading: 0,
      type: 'airplane' as const, laneOffset: 0, altitude: 2,
    }));
    renderer.update(planes);

    // 機身 + 尾翼都會投影，所以兩層加起來是兩倍。
    expect(drawnCount(scene), '飛機的尾翼沒有跟著長').toBe(planes.length * 2);
  });

  it('should keep drawing everything after the count falls back', () => {
    // 容量長大之後不能把後續的幀弄壞：count 要跟著縮回去，不能留著上一幀
    // 的殘影，也不能因為容量變大就把不存在的車畫出來。
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    renderer.update(cars(700));
    renderer.update(cars(12));

    expect(drawnCount(scene), '車少了之後畫出了不存在的車').toBe(12);
    expect(drawnAt(scene, cars(12)[11]!.x), '縮回去之後反而漏畫').toBe(true);
  });
});

import * as THREE from 'three';
import { type TrafficLight } from '../core/traffic/TrafficLights';
import { getLaneCount } from '../core/road/types';
import { LANE_GEOMETRY, type Direction } from '../core/traffic/LaneGraph';
import { SIDEWALK_WIDTH } from '../core/traffic/SidewalkGraph';
import { ROAD_WIDTHS } from './RoadStripBuilder';
import { STREET_LAMP_HEIGHT } from './RoadRenderer';

/**
 * 路口號誌。
 *
 * 每個路口四支，一個進入方向一支：燈桿站在**駛來的車那一側**的人行道上，
 * 橫臂從路緣彎進自己這半邊的車道正上方，燈頭吊在臂端。
 *
 * 原本四支都固定插在離中心線 0.18 的地方。號誌只出現在兩條幹道相交處，
 * 而四車道的路緣在 0.425、六車道在 0.475 —— 0.18 是在柏油路**裡面**，
 * 而且落在對向車道上：從北邊來的車走 x = −0.09，燈卻在 x = +0.18，跨過
 * 中心線、在駕駛的左手邊。
 */

/**
 * 桿高。**從路燈的高度算出來**，不是各寫一個數字 —— 號誌矮過路燈的話，
 * 讀起來就不像號誌，而分開寫的話路燈哪天調高了，號誌會靜靜地變成路邊最矮的
 * 那根柱子。
 */
const POLE_H = STREET_LAMP_HEIGHT + 0.04;

/** 號誌的尺寸（格；1 格 = 12 m）。 */
export const SIGNAL = {
  POLE_H,
  /** 橫臂的高度。略低於桿頂，讓桿露出一小截。 */
  ARM_Y: POLE_H - 0.02,
  /** 燈頭的中心高度。吊在橫臂**底下**。 */
  HEAD_Y: POLE_H - 0.045,
  /** 燈頭的邊長。 */
  HEAD_SIZE: 0.036,
  /** 桿的粗細。 */
  POLE_T: 0.016,
  /** 橫臂的粗細。 */
  ARM_T: 0.012,
  /**
   * 沿著行進方向離格心多遠。
   *
   * 近端：燈在車**進來**的那一側，就在停止線上方，不是路口對面。
   */
  STOP_LINE: 0.42,
} as const;

const POLE_COLOR = 0x333333;

/** 一支號誌的擺放。座標與 `TrafficLight` 同一套（格，格心為原點）。 */
export interface SignalMount {
  /** 這一支是給從哪個方向駛來的車看的。 */
  from: Direction;
  /** 桿底。 */
  poleX: number;
  poleZ: number;
  /** 燈頭（水平位置）。 */
  headX: number;
  headZ: number;
  /** 南北向（相位 0）還是東西向（相位 1）。 */
  isNS: boolean;
}

/** 各方向的單位向量：從格心指向那個方向。 */
const APPROACH: ReadonlyArray<{ dir: Direction; dx: number; dz: number; isNS: boolean }> = [
  { dir: 'north', dx: 0, dz: -1, isNS: true },
  { dir: 'south', dx: 0, dz: 1, isNS: true },
  { dir: 'east', dx: 1, dz: 0, isNS: false },
  { dir: 'west', dx: -1, dz: 0, isNS: false },
];

/**
 * 四支號誌的位置。
 *
 * 橫向的那一邊必須與 `LaneGraph` 的進場點同號。從方向 `d` 駛來的車，行進方向
 * 是 `opposite(d)`，靠右行駛 —— 換算成以 `d` 為基準就是**左**側，也就是
 * `(v.dz, -v.dx)`。這裡與 `LaneGraph.buildFromGrid` 的 `entryPerp` 是同一條式子；
 * 驗收拿真正的車道圖比對，不是再算一次（見 `TrafficLightPlacement.test.ts`）。
 */
export function signalMounts(
  light: { x: number; y: number; roadType: number },
): SignalMount[] {
  const width = ROAD_WIDTHS[light.roadType] ?? 0.6;
  // 桿站在人行道中線上 —— 路燈用的也是這條線（`RoadRenderer` 的 `half`）。
  const poleOffset = width / 2 + SIDEWALK_WIDTH / 2;
  // 燈頭吊在該向所有車道的**中間**：車道由內往外排 0..lanes×LANE_WIDTH，
  // 中點就是 lanes×LANE_WIDTH/2。單車道時剛好落在那條車道的中心線上。
  //
  // 不用最外側車道的外緣：六車道的 3×0.18 = 0.54 比路的半寬 0.475 還大
  // —— 車道模型與路寬模型在六車道上對不起來，取外緣會讓燈頭吊到路面外。
  const headOffset = getLaneCount(light.roadType) * LANE_GEOMETRY.LANE_WIDTH / 2;

  return APPROACH.map(({ dir, dx, dz, isNS }) => {
    const perpX = dz;
    const perpZ = -dx;
    const alongX = light.x + dx * SIGNAL.STOP_LINE;
    const alongZ = light.y + dz * SIGNAL.STOP_LINE;
    return {
      from: dir,
      poleX: alongX + perpX * poleOffset,
      poleZ: alongZ + perpZ * poleOffset,
      headX: alongX + perpX * headOffset,
      headZ: alongZ + perpZ * headOffset,
      isNS,
    };
  });
}

export class TrafficLightRenderer {
  private poleMesh: THREE.InstancedMesh | null = null;
  private armMesh: THREE.InstancedMesh | null = null;
  private lightMesh: THREE.InstancedMesh | null = null;
  private readonly maxLights = 2000; // 500 intersections × 4 indicators
  private lightCount = 0;
  private mounts: SignalMount[] = [];
  // Reusable per-frame colors
  private readonly _color = new THREE.Color();
  private readonly _green = new THREE.Color(0x00cc44);
  private readonly _red = new THREE.Color(0xdd2200);

  build(scene: THREE.Scene, lights: TrafficLight[]): void {
    this.dispose(scene);
    if (lights.length === 0) return;

    this.mounts = [];
    for (const light of lights) this.mounts.push(...signalMounts(light));
    this.lightCount = Math.min(this.mounts.length, this.maxLights);

    const matrix = new THREE.Matrix4();
    const poleMat = new THREE.MeshLambertMaterial({ color: POLE_COLOR });

    // 桿 —— 從地面立到 POLE_H
    const poleGeo = new THREE.BoxGeometry(SIGNAL.POLE_T, SIGNAL.POLE_H, SIGNAL.POLE_T);
    poleGeo.translate(0, SIGNAL.POLE_H / 2, 0);
    this.poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, this.lightCount);
    this.poleMesh.frustumCulled = false;
    this.poleMesh.castShadow = true;
    for (let i = 0; i < this.lightCount; i++) {
      const m = this.mounts[i]!;
      matrix.makeTranslation(m.poleX, 0, m.poleZ);
      this.poleMesh.setMatrixAt(i, matrix);
    }
    this.poleMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.poleMesh);

    // 橫臂 —— 單位長度的方棒，沿 +x 從原點長出去。每一支各自旋轉、各自拉長：
    // 臂長隨路寬變，而 InstancedMesh 只有一份幾何，長度只能靠矩陣的縮放。
    const armGeo = new THREE.BoxGeometry(1, SIGNAL.ARM_T, SIGNAL.ARM_T);
    armGeo.translate(0.5, 0, 0);
    this.armMesh = new THREE.InstancedMesh(armGeo, poleMat, this.lightCount);
    this.armMesh.frustumCulled = false;
    this.armMesh.castShadow = true;
    for (let i = 0; i < this.lightCount; i++) {
      const m = this.mounts[i]!;
      const ax = m.headX - m.poleX;
      const az = m.headZ - m.poleZ;
      const len = Math.hypot(ax, az);
      matrix.makeRotationY(Math.atan2(-az, ax));
      matrix.scale(new THREE.Vector3(len, 1, 1));
      matrix.setPosition(m.poleX, SIGNAL.ARM_Y, m.poleZ);
      this.armMesh.setMatrixAt(i, matrix);
    }
    this.armMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.armMesh);

    // 燈頭 —— 吊在臂端，會變色
    const headGeo = new THREE.BoxGeometry(SIGNAL.HEAD_SIZE, SIGNAL.HEAD_SIZE, SIGNAL.HEAD_SIZE);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lightMesh = new THREE.InstancedMesh(headGeo, headMat, this.lightCount);
    this.lightMesh.frustumCulled = false;
    for (let i = 0; i < this.lightCount; i++) {
      const m = this.mounts[i]!;
      matrix.makeTranslation(m.headX, SIGNAL.HEAD_Y, m.headZ);
      this.lightMesh.setMatrixAt(i, matrix);
    }
    this.lightMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.lightMesh);
  }

  /**
   * Update light colors based on current traffic light phases.
   * Call this every frame or every tick.
   */
  update(lights: Iterable<TrafficLight>): void {
    if (!this.lightMesh || this.lightCount === 0) return;

    const color = this._color;
    const GREEN = this._green;
    const RED = this._red;

    let idx = 0;
    for (const light of lights) {
      if (idx + 4 > this.lightCount) break;

      // All red during clearance, otherwise phase-based
      const nsGreen = !light.clearing && light.phase === 0;
      const ewGreen = !light.clearing && light.phase === 1;

      // 順序與 `signalMounts` 的 `APPROACH` 一致：北、南、東、西。
      for (let k = 0; k < 4; k++) {
        color.copy((this.mounts[idx]!.isNS ? nsGreen : ewGreen) ? GREEN : RED);
        this.lightMesh.setColorAt(idx++, color);
      }
    }

    if (this.lightMesh.instanceColor) {
      this.lightMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    // 桿與臂共用同一份材質，所以只 dispose 一次 —— 兩次的話第二次是對著
    // 已經釋放的資源呼叫。
    const disposed = new Set<THREE.Material>();
    for (const mesh of [this.poleMesh, this.armMesh, this.lightMesh]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material;
      if (!disposed.has(mat)) {
        mat.dispose();
        disposed.add(mat);
      }
    }
    this.poleMesh = null;
    this.armMesh = null;
    this.lightMesh = null;
    this.mounts = [];
    this.lightCount = 0;
  }
}

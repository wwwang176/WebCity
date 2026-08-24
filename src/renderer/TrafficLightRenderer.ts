import * as THREE from 'three';
import { type TrafficLight } from '../core/traffic/TrafficLights';
import { getLaneCount, getLaneWidth, RoadDirection } from '../core/road/types';
import { type Direction } from '../core/traffic/LaneGraph';
import { SIDEWALK_WIDTH } from '../core/traffic/SidewalkGraph';
import { ROAD_WIDTHS } from './RoadStripBuilder';
import { STREET_LAMP_HEIGHT, STREET_LAMP_BULB_RADIUS, STREET_LAMP_COLOR }
  from './RoadRenderer';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';
import { setMeshDim } from './ViewModeDim';

/**
 * Junction signals.
 *
 * Four per junction, one per approach: the pole stands on the sidewalk **on the side traffic
 * arrives from**, the arm reaches from the kerb over that half's lanes, and the head hangs at the
 * arm's tip.
 *
 * Fixed at 0.18 from the centre line, all four sit **inside** the asphalt — signals only appear
 * where two arterials cross, and a four-lane kerb is at 0.425 and a six-lane at 0.475 — and on the
 * opposing carriageway: traffic from the north runs at x = -0.09 while the signal is at x = +0.18,
 * across the centre line and on the driver's left.
 */

/**
 * Pole height, **derived from the street lamp's height** rather than written separately: a signal
 * shorter than a street lamp does not read as a signal, and written separately it silently becomes
 * the shortest post on the street the day the lamps are raised.
 */
const POLE_H = STREET_LAMP_HEIGHT + 0.04;

/** The arm's height, just below the pole's top so a short length of pole shows above it. */
const ARM_Y = POLE_H - 0.02;

/** The arm's thickness. */
const ARM_T = 0.012;

/** The head's edge length, capped at the street lamp's bulb: larger, and a junction becomes a row of lanterns. */
const HEAD_SIZE = STREET_LAMP_BULB_RADIUS;

/** The signal's dimensions, in cells (1 cell = 12 m). */
export const SIGNAL = {
  POLE_H,
  ARM_Y,
  ARM_T,
  HEAD_SIZE,
  /**
   * The head's centre height.
   *
   * **Derived from the arm's underside** rather than hard-coded: hard-coded, a change to the bulb
   * size opens a gap between the two and the bulb looks like it is floating. That is exactly what
   * happens on shrinking the bulb to street-lamp size: a gap of 0.01 cells, 12 cm.
   */
  HEAD_Y: ARM_Y - ARM_T / 2 - HEAD_SIZE / 2,
  /**
   * How far the arm reaches, as a fraction of the distance from the kerb to the middle of that
   * approach's lanes.
   *
   * Reaching all the way puts the head exactly on the lane centre line, but the arm then looks
   * over-long in an isometric view. A purely visual value, with its lower bound guarded by "the
   * whole head has to be above the asphalt".
   */
  ARM_REACH: 2 / 3,
  /** The pole's thickness. */
  POLE_T: 0.016,
  /**
   * How far from the cell centre along the direction of travel.
   *
   * The near side: the signal is on the side traffic **arrives** from, over the stop line, rather
   * than across the junction.
   */
  STOP_LINE: 0.42,
} as const;

/** One signal's placement. Coordinates use the same system as `TrafficLight`: cells, with the cell centre as origin. */
export interface SignalMount {
  /** Which approach this one faces. */
  from: Direction;
  /** The pole's foot. */
  poleX: number;
  poleZ: number;
  /** The head's horizontal position. */
  headX: number;
  headZ: number;
  /** North-south (phase 0) or east-west (phase 1). */
  isNS: boolean;
}

/** Unit vectors per direction, pointing from the cell centre outward. */
const APPROACH: ReadonlyArray<{
  dir: Direction; dx: number; dz: number; isNS: boolean; flag: number;
}> = [
  { dir: 'north', dx: 0, dz: -1, isNS: true, flag: RoadDirection.NORTH },
  { dir: 'south', dx: 0, dz: 1, isNS: true, flag: RoadDirection.SOUTH },
  { dir: 'east', dx: 1, dz: 0, isNS: false, flag: RoadDirection.EAST },
  { dir: 'west', dx: -1, dz: 0, isNS: false, flag: RoadDirection.WEST },
];

/**
 * The four signals' positions.
 *
 * The lateral side has to carry the same sign as `LaneGraph`'s entry point. Traffic arriving from
 * direction `d` travels toward `opposite(d)` and keeps right, which relative to `d` is the **left**
 * side, that is `(v.dz, -v.dx)`. This is the same expression as `entryPerp` in
 * `LaneGraph.buildFromGrid`, and the acceptance test compares against the real lane graph rather
 * than computing it a second time (see `TrafficLightPlacement.test.ts`).
 */
export function signalMounts(
  light: { x: number; y: number; roadType: number; roadFlags: number },
): SignalMount[] {
  const width = ROAD_WIDTHS[light.roadType] ?? 0.6;
  // The pole stands on the sidewalk's centre line, the same line street lamps use
  // (`RoadRenderer`'s `half`).
  const poleOffset = width / 2 + SIDEWALK_WIDTH / 2;
  // The **middle** of that approach's lanes: lanes run from the inside outward across
  // 0..lanes x LANE_WIDTH, so the midpoint is lanes x LANE_WIDTH / 2. With one lane it lands
  // exactly on that lane's centre line.
  //
  // Not the outermost lane's outer edge: at six lanes, 3 x 0.18 = 0.54 exceeds the road's
  // half-width of 0.475. The lane model and the road width model disagree at six lanes, and taking
  // the outer edge hangs the head off the carriageway.
  const laneMid = getLaneCount(light.roadType) * getLaneWidth(light.roadType) / 2;
  // The arm covers `ARM_REACH` of that distance, so the head lands between the lanes and the
  // kerb.
  const headOffset = poleOffset - (poleOffset - laneMid) * SIGNAL.ARM_REACH;

  return APPROACH.filter(a => (light.roadFlags & a.flag) !== 0).map(({ dir, dx, dz, isNS }) => {
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
  /**
   * Which light each signal belongs to, as an index into the array `build` received.
   *
   * It cannot be computed as four per light: a T junction has three, and with a fixed stride every
   * signal after the first T junction takes the wrong light's colour.
   */
  private mountOwner: number[] = [];
  private viewMode: ViewMode = ViewMode.NORMAL;
  // Reusable per-frame colors
  private readonly _color = new THREE.Color();
  private readonly _green = new THREE.Color(0x00cc44);
  private readonly _red = new THREE.Color(0xdd2200);
  private readonly _states: { ns: boolean; ew: boolean }[] = [];

  build(scene: THREE.Scene, lights: TrafficLight[]): void {
    this.dispose(scene);
    if (lights.length === 0) return;

    this.mounts = [];
    this.mountOwner = [];
    for (let li = 0; li < lights.length; li++) {
      for (const m of signalMounts(lights[li]!)) {
        this.mounts.push(m);
        this.mountOwner.push(li);
      }
    }
    this.lightCount = Math.min(this.mounts.length, this.maxLights);

    const matrix = new THREE.Matrix4();
    // Pole and arm take the street lamp's colour: metal posts along a street should be one colour,
    // and written as separate hex values the signals silently keep the old one when the lamps
    // change.
    const poleMat = new THREE.MeshLambertMaterial({ color: STREET_LAMP_COLOR });

    // The pole, standing from the ground to POLE_H.
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

    // The arm: a unit-length bar extending from the origin along +x. Each one is rotated and
    // stretched individually, since the arm's length varies with road width while an InstancedMesh
    // has one geometry and length can only come from the matrix's scale.
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

    // The head, hanging at the arm's tip and changing colour.
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

    this.applyViewMode();
  }

  /**
   * Signals are street furniture like street lamps, so they follow `road`'s opacity.
   *
   * The mode is stored here because changing a junction rebuilds everything through `build()` with
   * fresh materials, and the view mode has to be reapplied afterwards; otherwise editing a junction
   * in underground mode adds a row of solid traffic lights.
   */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.applyViewMode();
  }

  private applyViewMode(): void {
    const opacity = VIEW_MODE_OPACITY[this.viewMode].road;
    // Pole and arm share one material, and reapplying is harmless: the original colour is recorded
    // on the first pass.
    for (const mesh of [this.poleMesh, this.armMesh, this.lightMesh]) {
      if (mesh) setMeshDim(mesh, opacity);
    }
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

    // Compute each light's colour for this frame, then distribute it through `mountOwner`.
    const states = this._states;
    states.length = 0;
    for (const light of lights) {
      // All red during clearance, otherwise phase-based
      states.push({
        ns: !light.clearing && light.phase === 0,
        ew: !light.clearing && light.phase === 1,
      });
    }

    for (let idx = 0; idx < this.lightCount; idx++) {
      const st = states[this.mountOwner[idx]!];
      if (!st) break;
      color.copy((this.mounts[idx]!.isNS ? st.ns : st.ew) ? GREEN : RED);
      this.lightMesh.setColorAt(idx, color);
    }

    if (this.lightMesh.instanceColor) {
      this.lightMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    // Pole and arm share one material, so it is disposed once; twice, the second call is against
    // an already released resource.
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
    this.mountOwner = [];
    this.lightCount = 0;
  }
}

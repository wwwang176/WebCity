import * as THREE from 'three';
import { CrossingState, type LevelCrossing } from '../core/rail/LevelCrossingSystem';
import { ViewMode, VIEW_MODE_OPACITY } from '../core/ViewMode';

/**
 * Renders level crossing (railroad crossing) visual elements:
 * - Barrier posts with gates that lower when active
 * - Flashing red warning lights
 */

// Layout constants
const POST_HEIGHT = 0.18;
const POST_RADIUS = 0.012;
const GATE_LENGTH = 0.35;
const GATE_HEIGHT = 0.008;
const GATE_WIDTH = 0.02;
const LIGHT_RADIUS = 0.016;
const LIGHT_Y = POST_HEIGHT + 0.04;
const POST_Y_BASE = 0.04;

// Colors
const POST_COLOR = 0x333333;
const GATE_COLOR_IDLE = 0xdddddd;
const GATE_COLOR_ACTIVE = 0xff2222;
const LIGHT_OFF = 0x440000;
const LIGHT_ON = 0xff0000;

export class LevelCrossingRenderer {
  private group: THREE.Group | null = null;
  private postMeshes: THREE.InstancedMesh | null = null;
  private gateMeshes: THREE.Mesh[] = [];
  /** Per-gate: the rotation axis ('x' or 'z') and the "up" angle value. */
  private gateAxes: ('x' | 'z')[] = [];
  private gateUpAngles: number[] = [];

  private lightMeshesL: THREE.Mesh[] = [];
  private lightMeshesR: THREE.Mesh[] = [];

  /** Per-crossing metadata for animation. */
  private crossingData: Array<{
    x: number;
    y: number;
    gateIndices: number[];
    lightLIdx: number;
    lightRIdx: number;
  }> = [];

  build(scene: THREE.Scene, crossings: readonly LevelCrossing[]): void {
    this.dispose(scene);

    if (crossings.length === 0) return;

    this.group = new THREE.Group();
    this.group.name = 'levelCrossings';
    this.crossingData = [];

    // Shared geometries
    const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, POST_HEIGHT, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: POST_COLOR });

    const gateGeo = new THREE.BoxGeometry(GATE_LENGTH, GATE_HEIGHT, GATE_WIDTH);
    const gateMat = new THREE.MeshLambertMaterial({ color: GATE_COLOR_IDLE });

    const lightGeo = new THREE.SphereGeometry(LIGHT_RADIUS, 8, 6);
    const lightMatOff = new THREE.MeshBasicMaterial({ color: LIGHT_OFF });

    // Build per crossing: 2 posts, 2 gates, 2 lights
    const postCount = crossings.length * 2;
    this.postMeshes = new THREE.InstancedMesh(postGeo, postMat, postCount);
    this.postMeshes.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    let postIdx = 0;

    for (const c of crossings) {
      const isNS = c.railOrientation === 'NS';
      // Right-hand traffic: two posts at DIAGONAL corners (SW & NE).
      // Each gate blocks the approaching lane on the right side of traffic.
      //
      // NS track (rail ↕, road ↔):
      //   SW post: west of track, south curb → arm extends east (+X) across eastbound lane
      //   NE post: east of track, north curb → arm extends west (-X) across westbound lane
      //
      // EW track (rail ↔, road ↕):
      //   SW post: west curb, south of track → arm extends north (-Z) across southbound lane
      //   NE post: east curb, north of track → arm extends south (+Z) across northbound lane
      const CURB = 0.38;   // distance from center to road curb
      const SIDE = 0.22;   // distance from center along road (which side of track)

      let p1x: number, p1z: number, p2x: number, p2z: number;
      if (isNS) {
        // SW: (x - side, y + curb), NE: (x + side, y - curb)
        p1x = c.x - SIDE; p1z = c.y + CURB;
        p2x = c.x + SIDE; p2z = c.y - CURB;
      } else {
        // Gate before track for RHT: west curb north of track, east curb south of track
        p1x = c.x - CURB; p1z = c.y - SIDE;
        p2x = c.x + CURB; p2z = c.y + SIDE;
      }

      // Posts
      matrix.makeTranslation(p1x, POST_Y_BASE + POST_HEIGHT / 2, p1z);
      this.postMeshes.setMatrixAt(postIdx++, matrix);
      matrix.makeTranslation(p2x, POST_Y_BASE + POST_HEIGHT / 2, p2z);
      this.postMeshes.setMatrixAt(postIdx++, matrix);

      // Gates — pivot from post top.
      // angle 0 = horizontal (blocking/down), upAngle = vertical (clear/up).
      // dir: SW post = 1, NE post = -1
      const gateIdxStart = this.gateMeshes.length;
      for (const [px, pz, dir] of [[p1x, p1z, 1], [p2x, p2z, -1]] as const) {
        const gate = new THREE.Mesh(gateGeo.clone(), gateMat.clone());
        gate.position.set(px, POST_Y_BASE + POST_HEIGHT, pz);

        let axis: 'x' | 'z';
        let upAngle: number;

        if (isNS) {
          // Arms extend along Z (⊥ to E-W road): SW→north(-Z), NE→south(+Z)
          gate.geometry.rotateY(Math.PI / 2);
          gate.geometry.translate(0, 0, -GATE_LENGTH / 2 * dir);
          axis = 'x';
          upAngle = dir * Math.PI / 2;
        } else {
          // Arms extend along X (⊥ to N-S road): SW→east(+X), NE→west(-X)
          gate.geometry.translate(GATE_LENGTH / 2 * dir, 0, 0);
          axis = 'z';
          upAngle = dir * Math.PI / 2;
        }

        // Start in UP (clear) position
        if (axis === 'z') gate.rotation.z = upAngle;
        else gate.rotation.x = upAngle;

        this.gateMeshes.push(gate);
        this.gateAxes.push(axis);
        this.gateUpAngles.push(upAngle);
        this.group.add(gate);
      }

      // Warning lights — on top of posts
      const lightL = new THREE.Mesh(lightGeo.clone(), lightMatOff.clone());
      lightL.position.set(p1x, LIGHT_Y, p1z);
      this.lightMeshesL.push(lightL);
      this.group.add(lightL);

      const lightR = new THREE.Mesh(lightGeo.clone(), lightMatOff.clone());
      lightR.position.set(p2x, LIGHT_Y, p2z);
      this.lightMeshesR.push(lightR);
      this.group.add(lightR);

      this.crossingData.push({
        x: c.x,
        y: c.y,
        gateIndices: [gateIdxStart, gateIdxStart + 1],
        lightLIdx: this.lightMeshesL.length - 1,
        lightRIdx: this.lightMeshesR.length - 1,
      });
    }

    this.postMeshes.instanceMatrix.needsUpdate = true;
    this.group.add(this.postMeshes);
    scene.add(this.group);
  }

  /** Update gate positions and light colors based on crossing state. */
  update(elapsedTime: number, crossings: readonly LevelCrossing[]): void {
    if (this.crossingData.length === 0) return;

    const stateMap = new Map<string, CrossingState>();
    for (const c of crossings) {
      stateMap.set(`${c.x},${c.y}`, c.state);
    }

    for (const cd of this.crossingData) {
      const state = stateMap.get(`${cd.x},${cd.y}`) ?? CrossingState.CLEAR;
      const isActive = state === CrossingState.ACTIVE;

      // Gate angle: 0 = down (horizontal, blocking), upAngle = up (vertical, clear)
      for (const gi of cd.gateIndices) {
        const gate = this.gateMeshes[gi];
        if (!gate) continue;

        const angle = isActive ? 0 : this.gateUpAngles[gi]!;
        const axis = this.gateAxes[gi]!;

        if (axis === 'z') gate.rotation.z = angle;
        else gate.rotation.x = angle;

        (gate.material as THREE.MeshLambertMaterial).color.setHex(
          isActive ? GATE_COLOR_ACTIVE : GATE_COLOR_IDLE
        );
      }

      // Animate lights — alternating flash at ~3Hz
      const flash = Math.sin(elapsedTime * 6 * Math.PI) > 0;
      const lightL = this.lightMeshesL[cd.lightLIdx];
      const lightR = this.lightMeshesR[cd.lightRIdx];

      if (lightL) {
        (lightL.material as THREE.MeshBasicMaterial).color.setHex(
          isActive && flash ? LIGHT_ON : LIGHT_OFF
        );
      }
      if (lightR) {
        (lightR.material as THREE.MeshBasicMaterial).color.setHex(
          isActive && !flash ? LIGHT_ON : LIGHT_OFF
        );
      }
    }
  }

  setViewMode(mode: ViewMode): void {
    if (!this.group) return;
    this.group.visible = VIEW_MODE_OPACITY[mode].levelCrossing > 0;
  }

  /** @deprecated Use setViewMode instead. */
  setUndergroundMode(enabled: boolean): void {
    this.setViewMode(enabled ? ViewMode.UNDERGROUND : ViewMode.NORMAL);
  }

  dispose(scene: THREE.Scene): void {
    if (this.group) {
      scene.remove(this.group);
      this.group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
        if (child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) (child.material as THREE.Material).dispose();
        }
      });
    }
    this.group = null;
    this.postMeshes = null;
    this.gateMeshes = [];
    this.gateAxes = [];
    this.gateUpAngles = [];
    this.lightMeshesL = [];
    this.lightMeshesR = [];
    this.crossingData = [];
  }
}

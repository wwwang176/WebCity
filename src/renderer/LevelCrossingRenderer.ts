import * as THREE from 'three';
import { CrossingState, type LevelCrossing } from '../core/rail/LevelCrossingSystem';

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

// Gate lowering
const GATE_UP_ANGLE = 0; // radians — horizontal offset when up (vertical)
const GATE_DOWN_ANGLE = Math.PI / 2; // radians — horizontal when down

export class LevelCrossingRenderer {
  private group: THREE.Group | null = null;
  private postMeshes: THREE.InstancedMesh | null = null;
  private gateMeshes: THREE.Mesh[] = [];
  private lightMeshesL: THREE.Mesh[] = [];
  private lightMeshesR: THREE.Mesh[] = [];

  /** Per-crossing metadata for animation. */
  private crossingData: Array<{
    x: number;
    y: number;
    orientation: 'NS' | 'EW';
    gateIndices: number[]; // indices into gateMeshes
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
      // For NS track: posts and gates on east and west sides of the cell
      // For EW track: posts and gates on north and south sides of the cell
      const offset = 0.42; // distance from cell center to post

      const p1x = isNS ? c.x - offset : c.x;
      const p1z = isNS ? c.y : c.y - offset;
      const p2x = isNS ? c.x + offset : c.x;
      const p2z = isNS ? c.y : c.y + offset;

      // Posts
      matrix.makeTranslation(p1x, POST_Y_BASE + POST_HEIGHT / 2, p1z);
      this.postMeshes.setMatrixAt(postIdx++, matrix);
      matrix.makeTranslation(p2x, POST_Y_BASE + POST_HEIGHT / 2, p2z);
      this.postMeshes.setMatrixAt(postIdx++, matrix);

      // Gates — pivoted from the post position, extend perpendicular to the road
      const gateIdxStart = this.gateMeshes.length;
      for (const [px, pz, dir] of [[p1x, p1z, 1], [p2x, p2z, -1]] as const) {
        const gate = new THREE.Mesh(gateGeo.clone(), gateMat.clone());
        // Position at top of post, extending along road direction
        gate.position.set(px, POST_Y_BASE + POST_HEIGHT, pz);
        // Gate extends perpendicular to track
        if (isNS) {
          // Track runs N-S, gates extend E-W → already correct orientation
          // Pivot point adjustment: shift gate so it pivots from post end
          gate.geometry.translate(GATE_LENGTH / 2 * dir, 0, 0);
        } else {
          // Track runs E-W, gates extend N-S
          gate.geometry.translate(0, 0, GATE_LENGTH / 2 * dir);
          gate.rotation.y = 0;
        }
        this.gateMeshes.push(gate);
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
        orientation: c.railOrientation,
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

    // Build a quick lookup from position → state
    const stateMap = new Map<string, CrossingState>();
    for (const c of crossings) {
      stateMap.set(`${c.x},${c.y}`, c.state);
    }

    for (const cd of this.crossingData) {
      const state = stateMap.get(`${cd.x},${cd.y}`) ?? CrossingState.CLEAR;
      const isActive = state === CrossingState.ACTIVE;

      // Animate gates
      const targetAngle = isActive ? GATE_DOWN_ANGLE : GATE_UP_ANGLE;
      for (const gi of cd.gateIndices) {
        const gate = this.gateMeshes[gi];
        if (!gate) continue;

        // Smooth LERP toward target
        if (cd.orientation === 'NS') {
          // Gates pivot around Z axis (lower by rotating forward/back)
          const current = gate.rotation.z;
          gate.rotation.z += (targetAngle - current) * 0.15;
        } else {
          // Gates pivot around X axis
          const current = gate.rotation.x;
          gate.rotation.x += (targetAngle - current) * 0.15;
        }

        // Gate color
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

  setUndergroundMode(enabled: boolean): void {
    if (!this.group) return;
    this.group.visible = !enabled;
  }

  dispose(scene: THREE.Scene): void {
    if (this.group) {
      scene.remove(this.group);
      // Dispose all children
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
    this.lightMeshesL = [];
    this.lightMeshesR = [];
    this.crossingData = [];
  }
}

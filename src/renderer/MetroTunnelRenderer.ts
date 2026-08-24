import * as THREE from 'three';
import type { TunnelSegment } from '../core/transport/MetroTunnelPath';
import type { TransportStop } from '../core/transport/types';
import { UNDERGROUND_TUNNEL_Y } from '../core/ViewMode';
import { buildMetroCarriageGeometry } from './geometry';
import {
  buildLinePath,
  distanceToSegmentParam,
  advanceTrain,
  type LinePath,
  type TrainAnimState,
} from '../core/transport/MetroLinePath';

/** Tunnel constants. */
const TUNNEL_Y = UNDERGROUND_TUNNEL_Y;
const TUNNEL_RADIUS = 0.12;
const TUNNEL_SEGMENTS = 20;
const TUNNEL_COLOR = 0x00acc1;
const TUNNEL_INNER_COLOR = 0x004d59;
const STATION_RADIUS = 0.22;
const STATION_COLOR = 0x00e5ff;
const TRAIN_COLOR = 0x00bcd4;

/** Train animation constants. */
const CARRIAGES_PER_TRAIN = 3;
const CARRIAGE_SPACING = 0.25;        // world units, center-to-center
const MAX_CARRIAGES = 50 * CARRIAGES_PER_TRAIN;
const VISUAL_SPEED = 1.5;            // world units per second
const STATION_WAIT_TIME = 1.2;       // seconds to wait at each station

/** One tunnel segment's data, carrying lineId so a train can look up its curve. */
export interface MetroLineData {
  lineId: number;
  stops: readonly { x: number; y: number }[];
  segments: TunnelSegment[];
  trainCount: number;
}

/** The cached render path per line. */
interface LineRenderPath {
  linePath: LinePath;
  curves: THREE.CatmullRomCurve3[];
  curveLengths: number[];        // actual arc lengths from Three.js
  cumulativeLengths: number[];   // [0, L0, L0+L1, ...]
  totalLength: number;
}

/**
 * MetroTunnelRenderer — draws the metro's tunnel tubes and its trains.
 *
 * Train movement is animation on the render side alone and does not depend on simulation ticks.
 * Each train draws 3 carriages, each oriented independently along the curve.
 */
export class MetroTunnelRenderer {
  private tunnelGroup: THREE.Group;
  private scene: THREE.Scene | null = null;

  // Carriage instanced mesh (3 per train)
  private carriageMesh: THREE.InstancedMesh | null = null;
  private carriageMaterial: THREE.MeshLambertMaterial | null = null;

  // Line render paths (rebuilt when topology changes)
  private lineRenderPaths = new Map<number, LineRenderPath>();

  // Train animation states: key = "lineId-trainIdx"
  private trainStates = new Map<string, TrainAnimState>();

  // Track line topology for change detection
  private lineTopologyHash = new Map<number, string>();

  // Cached tunnel meshes per line (avoid per-frame rebuild)
  private lineTunnelMeshes = new Map<number, THREE.Mesh[]>();

  // Cached station meshes (avoid per-frame rebuild)
  private stationMeshes: THREE.Mesh[] = [];
  private stationHash = '';

  // Last opacity applied (for material-only updates)
  private lastOpacity = -1;

  // Reusable per-frame objects
  private readonly _color = new THREE.Color(TRAIN_COLOR);
  private readonly _rotation = new THREE.Matrix4();
  private readonly _translation = new THREE.Matrix4();
  private readonly _matrix = new THREE.Matrix4();

  constructor() {
    this.tunnelGroup = new THREE.Group();
    this.tunnelGroup.visible = false;
  }

  build(scene: THREE.Scene): void {
    this.dispose();
    this.scene = scene;
    scene.add(this.tunnelGroup);

    // Build carriage instanced mesh
    const geo = buildMetroCarriageGeometry();
    this.carriageMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.carriageMesh = new THREE.InstancedMesh(geo, this.carriageMaterial, MAX_CARRIAGES);
    this.carriageMesh.count = 0;
    this.carriageMesh.frustumCulled = false;
    this.carriageMesh.renderOrder = 15;
    this.tunnelGroup.add(this.carriageMesh);
  }

  /**
   * Updates the tunnel geometry and the train animations.
   * @param dt - The render frame interval in seconds, used to advance the train animations.
   */
  update(
    lines: MetroLineData[],
    stations: readonly TransportStop[],
    opacity: number,
    dt: number,
  ): void {
    this.tunnelGroup.visible = opacity > 0;
    if (opacity <= 0) {
      if (this.carriageMesh) this.carriageMesh.count = 0;
      return;
    }

    // Build/update tunnel tubes (only rebuilds changed lines)
    this.rebuildTunnels(lines, opacity);

    // Build/update station spheres (only rebuilds when stations change)
    this.updateStationSpheres(stations, opacity);

    // Update opacity on all cached meshes if changed
    if (opacity !== this.lastOpacity) {
      this.lastOpacity = opacity;
      this.updateAllMeshOpacity(opacity);
    }

    // Advance and render train animation
    this.updateTrainAnimation(dt, lines);
  }

  private rebuildTunnels(lines: MetroLineData[], opacity: number): void {
    const activeLineIds = new Set<number>();

    for (const lineData of lines) {
      activeLineIds.add(lineData.lineId);

      // Check if topology changed
      const hash = lineData.stops.map(s => `${s.x},${s.y}`).join('|');
      const needsRebuild = this.lineTopologyHash.get(lineData.lineId) !== hash;

      if (!needsRebuild) continue;

      this.lineTopologyHash.set(lineData.lineId, hash);
      this.rebuildLineRenderPath(lineData);

      // Dispose old tunnel meshes for this line
      this.disposeLineTunnelMeshes(lineData.lineId);

      // Build new tunnel geometry
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath) continue;

      const meshes: THREE.Mesh[] = [];
      for (const curve of renderPath.curves) {
        // Outer shell
        const outerGeo = new THREE.TubeGeometry(curve, TUNNEL_SEGMENTS, TUNNEL_RADIUS, 8, false);
        const outerMat = new THREE.MeshBasicMaterial({
          color: TUNNEL_COLOR,
          transparent: true,
          opacity: opacity * 0.6,
          side: THREE.BackSide,
          depthWrite: false,
        });
        const outerMesh = new THREE.Mesh(outerGeo, outerMat);
        outerMesh.renderOrder = 10;
        this.tunnelGroup.add(outerMesh);
        meshes.push(outerMesh);

        // Inner core
        const innerGeo = new THREE.TubeGeometry(curve, TUNNEL_SEGMENTS, TUNNEL_RADIUS * 0.4, 6, false);
        const innerMat = new THREE.MeshBasicMaterial({
          color: TUNNEL_INNER_COLOR,
          transparent: true,
          opacity: opacity * 0.9,
        });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        innerMesh.renderOrder = 11;
        this.tunnelGroup.add(innerMesh);
        meshes.push(innerMesh);
      }
      this.lineTunnelMeshes.set(lineData.lineId, meshes);
      this.lastOpacity = opacity;
    }

    // Clean up removed lines
    for (const lineId of this.lineRenderPaths.keys()) {
      if (!activeLineIds.has(lineId)) {
        this.disposeLineTunnelMeshes(lineId);
        this.lineRenderPaths.delete(lineId);
        this.lineTopologyHash.delete(lineId);
      }
    }
  }

  private disposeLineTunnelMeshes(lineId: number): void {
    const meshes = this.lineTunnelMeshes.get(lineId);
    if (meshes) {
      for (const mesh of meshes) {
        this.tunnelGroup.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      }
      this.lineTunnelMeshes.delete(lineId);
    }
  }

  private rebuildLineRenderPath(lineData: MetroLineData): void {
    const linePath = buildLinePath(lineData.stops as { x: number; y: number }[]);
    if (linePath.segments.length === 0) return;

    const curves: THREE.CatmullRomCurve3[] = [];
    const curveLengths: number[] = [];
    const cumulativeLengths: number[] = [0];

    for (const seg of linePath.segments) {
      const points = seg.controlPoints.map(
        p => new THREE.Vector3(p.x, TUNNEL_Y, p.y)
      );
      const curve = new THREE.CatmullRomCurve3(points);
      curves.push(curve);
      const len = curve.getLength();
      curveLengths.push(len);
      cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1]! + len);
    }

    const totalLength = cumulativeLengths[cumulativeLengths.length - 1]!;

    // Compute station distances using actual arc lengths
    const stationDistances: number[] = [];
    for (let i = 0; i < linePath.stationDistances.length; i++) {
      stationDistances.push(cumulativeLengths[i]!);
    }

    // Update linePath with accurate lengths
    const accurateLinePath: LinePath = {
      segments: linePath.segments,
      stationDistances,
      totalLength,
    };

    this.lineRenderPaths.set(lineData.lineId, {
      linePath: accurateLinePath,
      curves,
      curveLengths,
      cumulativeLengths,
      totalLength,
    });

    // Invalidate train states for this line (they'll be rebuilt)
    for (const key of this.trainStates.keys()) {
      if (key.startsWith(`${lineData.lineId}-`)) {
        this.trainStates.delete(key);
      }
    }
  }

  private updateStationSpheres(stations: readonly TransportStop[], opacity: number): void {
    // Compute station hash for change detection
    let hash = `${stations.length}`;
    for (const s of stations) hash += `:${s.x},${s.y}`;
    if (hash === this.stationHash) return;
    this.stationHash = hash;

    // Dispose old station meshes
    for (const mesh of this.stationMeshes) {
      this.tunnelGroup.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
    this.stationMeshes.length = 0;

    // Build new station meshes
    for (const station of stations) {
      const geo = new THREE.SphereGeometry(STATION_RADIUS, 12, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: STATION_COLOR,
        transparent: true,
        opacity: opacity * 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(station.x, TUNNEL_Y, station.y);
      mesh.renderOrder = 12;
      this.tunnelGroup.add(mesh);
      this.stationMeshes.push(mesh);

      const glowGeo = new THREE.SphereGeometry(STATION_RADIUS * 1.5, 10, 6);
      const glowMat = new THREE.MeshBasicMaterial({
        color: STATION_COLOR,
        transparent: true,
        opacity: opacity * 0.2,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(station.x, TUNNEL_Y, station.y);
      glowMesh.renderOrder = 9;
      this.tunnelGroup.add(glowMesh);
      this.stationMeshes.push(glowMesh);
    }
    this.lastOpacity = opacity;
  }

  /** Update opacity on all cached tunnel + station meshes (no geometry rebuild). */
  private updateAllMeshOpacity(opacity: number): void {
    for (const meshes of this.lineTunnelMeshes.values()) {
      for (let i = 0; i < meshes.length; i++) {
        const mat = meshes[i]!.material as THREE.MeshBasicMaterial;
        mat.opacity = (i % 2 === 0) ? opacity * 0.6 : opacity * 0.9;
      }
    }
    for (let i = 0; i < this.stationMeshes.length; i++) {
      const mat = this.stationMeshes[i]!.material as THREE.MeshBasicMaterial;
      mat.opacity = (i % 2 === 0) ? opacity * 0.85 : opacity * 0.2;
    }
  }

  private updateTrainAnimation(dt: number, lines: MetroLineData[]): void {
    if (!this.carriageMesh) return;

    // Ensure train states exist for all lines/trains
    for (const lineData of lines) {
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath || renderPath.totalLength <= 0) continue;

      for (let t = 0; t < lineData.trainCount; t++) {
        const key = `${lineData.lineId}-${t}`;
        if (!this.trainStates.has(key)) {
          // Spawn train evenly spaced along the line
          const d = lineData.trainCount > 1
            ? (t / lineData.trainCount) * renderPath.totalLength
            : 0;

          // Find next station
          let nextIdx = 0;
          for (let j = renderPath.linePath.stationDistances.length - 1; j >= 0; j--) {
            if (d >= renderPath.linePath.stationDistances[j]!) {
              nextIdx = (j + 1) % renderPath.linePath.stationDistances.length;
              break;
            }
          }

          this.trainStates.set(key, {
            distance: d,
            atStation: t === 0, // first train starts at station
            waitTimer: t === 0 ? STATION_WAIT_TIME : 0,
            nextStationIndex: nextIdx,
          });
        }
      }
    }

    // Remove train states for deleted lines/trains
    const validKeys = new Set<string>();
    for (const lineData of lines) {
      for (let t = 0; t < lineData.trainCount; t++) {
        validKeys.add(`${lineData.lineId}-${t}`);
      }
    }
    for (const key of this.trainStates.keys()) {
      if (!validKeys.has(key)) {
        this.trainStates.delete(key);
      }
    }

    // Advance all trains and render carriages
    const color = this._color;
    const rotation = this._rotation;
    const translation = this._translation;
    const matrix = this._matrix;

    let instanceIdx = 0;

    for (const lineData of lines) {
      const renderPath = this.lineRenderPaths.get(lineData.lineId);
      if (!renderPath || renderPath.totalLength <= 0) continue;

      for (let t = 0; t < lineData.trainCount; t++) {
        const key = `${lineData.lineId}-${t}`;
        const state = this.trainStates.get(key);
        if (!state) continue;

        // Advance animation
        advanceTrain(
          state,
          dt,
          renderPath.totalLength,
          renderPath.linePath.stationDistances,
          VISUAL_SPEED,
          STATION_WAIT_TIME,
        );

        // Render 3 carriages
        for (let c = 0; c < CARRIAGES_PER_TRAIN; c++) {
          if (instanceIdx >= MAX_CARRIAGES) break;

          const carriageDist = state.distance - c * CARRIAGE_SPACING;
          const result = this.getPointOnRenderPath(renderPath, carriageDist);
          if (!result) continue;

          rotation.makeRotationY(result.heading);
          translation.makeTranslation(result.point.x, result.point.y, result.point.z);
          matrix.copy(translation).multiply(rotation);

          this.carriageMesh.setMatrixAt(instanceIdx, matrix);
          this.carriageMesh.setColorAt(instanceIdx, color);
          instanceIdx++;
        }
      }
    }

    this.carriageMesh.count = instanceIdx;
    this.carriageMesh.instanceMatrix.needsUpdate = true;
    if (this.carriageMesh.instanceColor) this.carriageMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Get position and heading on the line's render path at a given distance.
   * Uses actual CatmullRomCurve3 for smooth positioning.
   */
  private getPointOnRenderPath(
    renderPath: LineRenderPath,
    distance: number,
  ): { point: THREE.Vector3; heading: number } | null {
    if (renderPath.curves.length === 0) return null;

    // Wrap distance
    let d = distance % renderPath.totalLength;
    if (d < 0) d += renderPath.totalLength;

    // Find which curve segment
    for (let i = 0; i < renderPath.curves.length; i++) {
      const segEnd = renderPath.cumulativeLengths[i + 1]!;
      if (d <= segEnd || i === renderPath.curves.length - 1) {
        const localDist = d - renderPath.cumulativeLengths[i]!;
        const localT = renderPath.curveLengths[i]! > 0
          ? Math.min(1, Math.max(0, localDist / renderPath.curveLengths[i]!))
          : 0;

        const point = renderPath.curves[i]!.getPointAt(localT);
        const tangent = renderPath.curves[i]!.getTangentAt(localT);
        const heading = Math.atan2(-tangent.z, tangent.x);

        return { point, heading };
      }
    }

    return null;
  }

  dispose(): void {
    // Dispose all cached tunnel meshes
    for (const lineId of this.lineTunnelMeshes.keys()) {
      this.disposeLineTunnelMeshes(lineId);
    }

    // Dispose cached station meshes
    for (const mesh of this.stationMeshes) {
      this.tunnelGroup.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
    this.stationMeshes.length = 0;
    this.stationHash = '';
    this.lastOpacity = -1;

    // Dispose any remaining children (carriageMesh, etc.)
    while (this.tunnelGroup.children.length > 0) {
      const child = this.tunnelGroup.children[0]!;
      this.tunnelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    if (this.scene) {
      this.scene.remove(this.tunnelGroup);
    }
    this.carriageMesh = null;
    this.carriageMaterial = null;
    this.lineRenderPaths.clear();
    this.trainStates.clear();
    this.lineTopologyHash.clear();
    this.lineTunnelMeshes.clear();
  }

  /** The number of tunnel segments plus station spheres currently drawn, for tests. */
  getMeshCount(): number {
    return this.tunnelGroup.children.length;
  }

  /** Whether the tunnel group is visible. */
  isVisible(): boolean {
    return this.tunnelGroup.visible;
  }
}

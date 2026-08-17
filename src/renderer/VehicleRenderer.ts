import * as THREE from 'three';
import { createVehicleMaterial } from './vehicleMaterial';
import { VEHICLE_CONFIG } from './vehicleConfig';
import { buildAirplaneNavLightsGeometry, buildAirplaneVTailGeometry } from './geometry';
import { ViewMode, getVehicleVisibility } from '../core/ViewMode';
import { ROAD_SURFACE_Y, LEVEL_HEIGHT } from './surfaceHeights';

/** 車燈離路面多高。原本寫成 0.055 的絕對高度，那是舊的車身基準加 0.03。 */
const LIGHT_ABOVE_SURFACE = 0.03;

/** Airline body colors (vivid, multiplied with near-white vertex colors). */
const AIRLINE_BODY_COLORS = [
  0xffffff, 0x42a5f5, 0x66bb6a, 0xffa726, 0xec407a,
  0x26c6da, 0xab47bc, 0xffee58, 0x78909c, 0xff7043,
];

/** Airline tail colors (bold, shown directly via white vertex colors). */
const AIRLINE_TAIL_COLORS = [
  0x1565c0, 0xc62828, 0x2e7d32, 0xe65100, 0x6a1b9a,
  0x00695c, 0x0d47a1, 0xd32f2f, 0xef6c00, 0x4a148c,
];

export interface VehicleData {
  id: number;
  x: number;
  y: number;
  heading: number; // radians, 0 = facing +x (east)
  type: 'car' | 'van' | 'bus' | 'truck' | 'firetruck' | 'police_car' | 'ambulance' | 'garbage_truck' | 'transport_bus' | 'rail_train' | 'rail_carriage' | 'ferry' | 'airplane';
  laneOffset: number; // lateral offset perpendicular to heading (positive = right of heading)
  /** World Y position override (airplane altitude). */
  altitude?: number;
  /** Pitch angle in radians (nose up = positive). */
  pitch?: number;
  /** Roll angle in radians (right wing down = positive). */
  roll?: number;
  /** Uniform scale override. */
  scale?: number;
  /** Elevation level (0 = ground, 1-3 = elevated). Adds level × 0.6 to Y. */
  elevation?: number;
}

const CAR_COLORS = [
  0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xf4511e,
  0x8e24aa, 0x546e7a, 0xd4e157, 0xff8a65, 0x90a4ae,
  0x3949ab, 0x00897b, 0xc0ca33, 0x6d4c41, 0xffffff,
  0x263238, 0x1565c0, 0x4e342e,
];

/** Commercial / utility vehicle colors (trucks & vans). */
const COMMERCIAL_COLORS = [
  0xffffff, 0xeceff1, 0xcfd8dc,  // white / light grey (most common)
  0x37474f, 0x263238,             // dark grey / charcoal
  0x1565c0, 0x0d47a1,            // blue fleet
  0xc62828, 0xbf360c,            // red / dark orange
  0x2e7d32, 0x1b5e20,            // green
  0xf9a825, 0xff8f00,            // yellow / amber
];

// ── Renderer ─────────────────────────────────────────────────────────

export class VehicleRenderer {
  private meshes = new Map<string, THREE.InstancedMesh>();
  /**
   * 起始容量。不是上限 —— 不夠時 `grow` 會換一個更大的（見 BUG-261）。
   *
   * 寫死上限的話，越過的那些車照樣參與碰撞（`advanceEdgeVehicles` 走的是
   * `traffic.vehicles`，與渲染無關），只是不畫：畫面上是一台車對著一段空白
   * 煞車，過一兩秒那台看不見的車才憑空出現。而模擬端的上限是**全部車種
   * 合計**，車種分佈由城市決定，所以渲染端沒有一個逐車種的數字是安全的。
   */
  private readonly initialPerType = 500;
  private _viewMode = ViewMode.NORMAL;

  /**
   * 視錐剔除用的鏡頭。`null` 就不剔除（展示區、測試等不帶鏡頭的呼叫端）。
   *
   * 判準是鏡頭的視錐，不是離鏡頭目標的固定距離。行人那邊是固定半徑
   * （`cullPedestrians` 的 `CULL_RADIUS`），照抄的話鏡頭一拉遠，車就只出現在
   * 畫面中央一小圈。
   */
  private cullCamera: THREE.Camera | null = null;

  /**
   * 視錐往外放寬的格數。
   *
   * 剛好切在畫面邊界的話，邊緣的車會在鏡頭平移時突然消失／出現。車有體積
   * （公車、消防車比小客車長得多），而且會投影 —— 畫面外一點點的車，影子
   * 可能落在畫面裡。
   */
  private readonly cullMargin = 2;

  // Airplane sub-meshes: separate InstancedMesh for vtail (random color) and nav lights (blink)
  private airplaneVTailMesh: THREE.InstancedMesh | null = null;
  private airplaneNavMesh: THREE.InstancedMesh | null = null;

  // Headlight / taillight instanced meshes
  private headlightMesh: THREE.InstancedMesh | null = null;
  private taillightMesh: THREE.InstancedMesh | null = null;
  private headlightMaterial: THREE.MeshBasicMaterial | null = null;
  private taillightMaterial: THREE.MeshBasicMaterial | null = null;

  // Reusable per-frame objects (avoids ~720 allocations/second at 60fps)
  private readonly _groups = new Map<string, VehicleData[]>();
  private readonly _rotation = new THREE.Matrix4();
  private readonly _pitchRoll = new THREE.Matrix4();
  private readonly _pitchMat = new THREE.Matrix4();
  private readonly _translation = new THREE.Matrix4();
  private readonly _matrix = new THREE.Matrix4();
  private readonly _color = new THREE.Color();
  private readonly _hlMatrix = new THREE.Matrix4();
  private readonly _hlTranslation = new THREE.Matrix4();
  private readonly _tlMatrix = new THREE.Matrix4();
  private readonly _tlTranslation = new THREE.Matrix4();
  private readonly _frustum = new THREE.Frustum();
  private readonly _viewProjection = new THREE.Matrix4();
  private readonly _cullSphere = new THREE.Sphere(new THREE.Vector3(), 0);

  build(scene: THREE.Scene): void {
    this.dispose(scene);

    for (const [type, cfg] of Object.entries(VEHICLE_CONFIG)) {
      const geometry = cfg.buildGeometry();
      const material = createVehicleMaterial();
      const mesh = new THREE.InstancedMesh(geometry, material, this.initialPerType);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(type, mesh);
    }

    // Airplane vertical tail: separate mesh for independent airline tail color
    const vtGeo = buildAirplaneVTailGeometry();
    const vtMat = createVehicleMaterial();
    this.airplaneVTailMesh = new THREE.InstancedMesh(vtGeo, vtMat, this.initialPerType);
    this.airplaneVTailMesh.count = 0;
    this.airplaneVTailMesh.castShadow = true;
    this.airplaneVTailMesh.frustumCulled = false;
    scene.add(this.airplaneVTailMesh);

    // Airplane nav lights: separate mesh with MeshBasicMaterial (always bright)
    const navGeo = buildAirplaneNavLightsGeometry();
    const navMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.airplaneNavMesh = new THREE.InstancedMesh(navGeo, navMat, this.initialPerType);
    this.airplaneNavMesh.count = 0;
    this.airplaneNavMesh.frustumCulled = false;
    scene.add(this.airplaneNavMesh);

    // Headlight beam: trapezoid projected forward (narrow at car, wide at far end)
    // Vertices in local XZ plane (Y=0, facing up), beam extends along local +X
    const hlGeo = new THREE.BufferGeometry();
    const hlVerts = new Float32Array([
      // near edge (at car front): narrow, width ±0.06
      0,    0, -0.06,
      0,    0,  0.06,
      // far edge (projected forward 0.5): wide, width ±0.2
      0.5,  0, -0.2,
      0.5,  0,  0.2,
    ]);
    const hlIdx = [0, 2, 1, 1, 2, 3]; // two triangles forming trapezoid
    // Vertex colors: bright at car (near), fade to black at far end
    const hlColors = new Float32Array([
      1, 1, 1,   // near-left: full brightness
      1, 1, 1,   // near-right: full brightness
      0, 0, 0,   // far-left: black (transparent via additive)
      0, 0, 0,   // far-right: black
    ]);
    hlGeo.setAttribute('position', new THREE.BufferAttribute(hlVerts, 3));
    hlGeo.setAttribute('color', new THREE.BufferAttribute(hlColors, 3));
    hlGeo.setIndex(hlIdx);
    this.headlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffcc,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.headlightMesh = new THREE.InstancedMesh(hlGeo, this.headlightMaterial, this.initialPerType);
    this.headlightMesh.count = 0;
    this.headlightMesh.frustumCulled = false;
    this.headlightMesh.renderOrder = 10;
    scene.add(this.headlightMesh);

    // Taillight ground-disc mesh (red)
    const tlGeo = new THREE.CircleGeometry(0.08, 6);
    tlGeo.rotateX(-Math.PI / 2);
    this.taillightMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.taillightMesh = new THREE.InstancedMesh(tlGeo, this.taillightMaterial, this.initialPerType);
    this.taillightMesh.count = 0;
    this.taillightMesh.frustumCulled = false;
    this.taillightMesh.renderOrder = 10;
    scene.add(this.taillightMesh);
  }

  /**
   * 設定視錐剔除用的鏡頭。傳 `null` 就畫全部。
   *
   * 每幀從鏡頭當下的矩陣重算視錐，所以平移、旋轉、縮放都會自動跟上 ——
   * 呼叫端設一次就好。
   */
  setCullCamera(camera: THREE.Camera | null): void {
    this.cullCamera = camera;
  }

  /**
   * 這台車在畫面裡嗎。
   *
   * 用一顆半徑 `cullMargin` 的球去測而不是一個點：那顆球同時代表車的體積、
   * 它的影子，以及邊緣的餘裕。
   */
  private inView(v: VehicleData): boolean {
    const y = v.altitude ?? (v.elevation ? v.elevation * LEVEL_HEIGHT : 0);
    this._cullSphere.center.set(v.x, y, v.y);
    this._cullSphere.radius = this.cullMargin;
    return this._frustum.intersectsSphere(this._cullSphere);
  }

  /**
   * 讓一個 `InstancedMesh` 至少容得下 `need` 個實例，不夠就換一個更大的。
   *
   * `InstancedMesh` 的容量在建構時就固定了（`instanceMatrix` 的長度），所以
   * 「擴容」只能換一個新的接上場景。幾何與材質是**接手**過去的，不能 dispose
   * —— 那會把還在用的緩衝區收掉。
   *
   * 倍增而不是剛好夠：車輛數每幀都在變，剛好夠的話尖峰附近會一直重建。
   *
   * `instanceColor` 不用搬。它是 `setColorAt` 第一次呼叫時才長出來的，而顏色
   * 每幀都重寫一遍。
   */
  private grow(
    mesh: THREE.InstancedMesh | null, need: number,
  ): THREE.InstancedMesh | null {
    if (!mesh || need <= mesh.instanceMatrix.count) return mesh;
    let capacity = Math.max(mesh.instanceMatrix.count, 1);
    while (capacity < need) capacity *= 2;

    const bigger = new THREE.InstancedMesh(mesh.geometry, mesh.material, capacity);
    bigger.count = 0;
    bigger.castShadow = mesh.castShadow;
    bigger.receiveShadow = mesh.receiveShadow;
    bigger.frustumCulled = mesh.frustumCulled;
    bigger.renderOrder = mesh.renderOrder;
    bigger.visible = mesh.visible;
    mesh.parent?.add(bigger);
    mesh.removeFromParent();
    return bigger;
  }

  update(vehicles: VehicleData[], sunIntensity?: number, time?: number, simSpeed?: number): void {
    // Group vehicles by type (reuse Map + clear arrays instead of creating new ones)
    const groups = this._groups;
    for (const arr of groups.values()) arr.length = 0;

    // 視錐在這裡算一次，整幀共用。鏡頭的矩陣在渲染迴圈裡是最新的。
    const camera = this.cullCamera;
    if (camera) {
      camera.updateMatrixWorld();
      this._frustum.setFromProjectionMatrix(this._viewProjection.multiplyMatrices(
        camera.projectionMatrix, camera.matrixWorldInverse,
      ));
    }

    // 剔除發生在分組時，所以下游全部跟著走：逐車種的數量、頭尾燈的數量、
    // 擴容的判斷。在後面某一處另外過濾的話，那三個一定有一個會對不上。
    for (const v of vehicles) {
      if (camera && !this.inView(v)) continue;
      let arr = groups.get(v.type);
      if (!arr) { arr = []; groups.set(v.type, arr); }
      arr.push(v);
    }

    const rotation = this._rotation;
    const translation = this._translation;
    const matrix = this._matrix;
    const color = this._color;

    // Collect all vehicles in order for headlight/taillight indexing
    let lightIndex = 0;
    const hlMatrix = this._hlMatrix;
    const hlTranslation = this._hlTranslation;
    const tlMatrix = this._tlMatrix;
    const tlTranslation = this._tlTranslation;

    // 頭尾燈是一整批共用的，不像車身逐車種分開，所以要先數出這一幀要幾盞。
    // 鐵路車廂不掛燈（`rail_carriage` 在下面被跳過）。
    // 數的是剔除之後留下的那些（`groups`）而不是傳進來的整份。這只影響**容量**
    // —— 燈的數量是繪製迴圈跑完之後才寫進 `count` 的，拿整份算不會多畫燈，
    // 只是替看不見的車先配好位子。
    let lightNeed = 0;
    for (const [type, arr] of groups) if (type !== 'rail_carriage') lightNeed += arr.length;
    this.headlightMesh = this.grow(this.headlightMesh, lightNeed);
    this.taillightMesh = this.grow(this.taillightMesh, lightNeed);

    // 機尾與航行燈**必須在主迴圈之前**擴容：垂直尾翼的顏色是在主迴圈裡逐架
    // 寫進去的，之後才換 mesh 的話，那些顏色會留在被丟掉的那一個上面。
    const planeNeed = groups.get('airplane')?.length ?? 0;
    this.airplaneVTailMesh = this.grow(this.airplaneVTailMesh, planeNeed);
    this.airplaneNavMesh = this.grow(this.airplaneNavMesh, planeNeed);

    for (const [type, mesh0] of this.meshes) {
      const list = groups.get(type) ?? [];
      const mesh = this.grow(mesh0, list.length)!;
      if (mesh !== mesh0) this.meshes.set(type, mesh);
      const count = list.length;
      mesh.count = count;

      const cfg = VEHICLE_CONFIG[type];
      const fOff = cfg?.frontOffset ?? 0.12;
      const rOff = cfg?.rearOffset ?? 0.12;

      for (let i = 0; i < count; i++) {
        const v = list[i]!;

        // Lane offset: perpendicular to heading direction
        // Positive laneOffset shifts to the right of heading (sin/cos pattern)
        const offsetX = Math.sin(v.heading) * v.laneOffset;
        const offsetZ = Math.cos(v.heading) * v.laneOffset;

        const vx = v.x + offsetX;
        const vz = v.y + offsetZ;

        // Ferry bobbing animation: gentle vertical oscillation on water
        let yPos = cfg?.yPosition ?? 0.025;
        if (type === 'ferry' && time !== undefined) {
          yPos += Math.sin(time * 2 + v.id * 1.7) * 0.012;
        }
        // Airplane: override Y with altitude
        if (type === 'airplane' && v.altitude !== undefined) {
          yPos = v.altitude;
        }
        // Elevated road: add elevation height
        if (v.elevation && v.elevation > 0) {
          yPos += v.elevation * LEVEL_HEIGHT;
        }
        // Ramp pitch compensation: restore normal-direction offset lost to tilt
        if (v.pitch) {
          yPos += 0.025 * (1 - Math.cos(v.pitch));
        }

        rotation.makeRotationY(v.heading);
        // Pitch/roll: apply in local space (airplane, ramp vehicles, etc.)
        if (v.pitch || v.roll) {
          const pr = this._pitchRoll;
          pr.makeRotationX(v.roll ?? 0);
          if (v.pitch) {
            this._pitchMat.makeRotationZ(v.pitch);
            pr.multiply(this._pitchMat);
          }
          rotation.multiply(pr);
        }
        translation.makeTranslation(vx, yPos, vz);
        matrix.copy(translation).multiply(rotation);
        if (v.scale !== undefined) {
          this._pitchRoll.makeScale(v.scale, v.scale, v.scale);
          matrix.multiply(this._pitchRoll);
        }
        mesh.setMatrixAt(i, matrix);

        // Color: per-instance random from type-appropriate palette
        if (cfg && cfg.color === -1) {
          if (type === 'airplane') {
            color.set(AIRLINE_BODY_COLORS[v.id % AIRLINE_BODY_COLORS.length]!);
          } else {
            const palette = (type === 'truck' || type === 'van')
              ? COMMERCIAL_COLORS : CAR_COLORS;
            color.set(palette[v.id % palette.length]!);
          }
        } else {
          color.set(cfg?.color ?? 0xd32f2f);
        }
        mesh.setColorAt(i, color);

        // Airplane vtail: set tail color from separate palette
        if (type === 'airplane' && this.airplaneVTailMesh) {
          color.set(AIRLINE_TAIL_COLORS[(v.id * 7 + 3) % AIRLINE_TAIL_COLORS.length]!);
          this.airplaneVTailMesh.setColorAt(i, color);
        }

        // Headlight/taillight matrices — skip for rail carriages only
        if (type === 'rail_carriage') continue;
        if (this.headlightMesh && this.taillightMesh) {
          const cosH = Math.cos(v.heading);
          const sinH = Math.sin(v.heading);

          // Headlight beam: position at car front, rotate to match heading
          // Beam geometry extends along local +X, so Y-rotate by heading
          const hlX = vx + cosH * fOff;
          const hlZ = vz - sinH * fOff;
          // Light Y: airplane follows altitude; others use base + elevation
          // 車燈的高度是相對於路面量的 —— 車身抬到柏油表面之後，燈也要跟著抬，
          // 不然大燈會縮進保險桿裡。
          let lightY = type === 'airplane'
            ? yPos + 0.01
            : ROAD_SURFACE_Y + LIGHT_ABOVE_SURFACE + (v.elevation ? v.elevation * LEVEL_HEIGHT : 0);
          if (v.pitch && type !== 'airplane') lightY += 0.025 * (1 - Math.cos(v.pitch));
          hlMatrix.makeRotationY(v.heading);
          // Apply pitch rotation to headlights (ramp vehicles + airplanes)
          if (v.pitch) {
            this._pitchMat.makeRotationZ(v.pitch);
            hlMatrix.multiply(this._pitchMat);
          }
          if (type === 'airplane') {
            // Airplane: 2× longer/wider beam
            this._pitchRoll.makeScale(2, 1, 2);
            hlMatrix.multiply(this._pitchRoll);
          }
          // Headlight Y: adjust for slope height at front position
          const hlY = lightY + (v.pitch ? fOff * Math.tan(v.pitch) : 0);
          hlTranslation.makeTranslation(hlX, hlY, hlZ);
          hlMatrix.premultiply(hlTranslation);
          this.headlightMesh.setMatrixAt(lightIndex, hlMatrix);

          // Taillights: offset backward (airplanes: hide with zero scale)
          if (type === 'airplane') {
            tlMatrix.makeScale(0, 0, 0);
          } else {
            const tlX = vx - cosH * rOff;
            const tlZ = vz + sinH * rOff;
            // Taillight Y: adjust for slope height at rear position (opposite direction)
            const tlY = lightY - (v.pitch ? rOff * Math.tan(v.pitch) : 0);
            tlTranslation.makeTranslation(tlX, tlY, tlZ);
            tlMatrix.copy(tlTranslation);
            // Apply pitch to taillights too
            if (v.pitch) {
              this._pitchMat.makeRotationZ(v.pitch);
              tlMatrix.multiply(this._pitchMat);
            }
          }
          this.taillightMesh.setMatrixAt(lightIndex, tlMatrix);

          lightIndex++;
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // Focus modes: show only relevant vehicle types
      mesh.visible = getVehicleVisibility(this._viewMode, type);
    }

    // Airplane sub-meshes: copy transforms from main airplane mesh
    const airplaneMesh = this.meshes.get('airplane');
    if (airplaneMesh) {
      const count = airplaneMesh.count;
      const m = this._matrix;

      // Vertical tail (with per-instance airline tail color)
      if (this.airplaneVTailMesh) {
        this.airplaneVTailMesh.count = count;
        for (let i = 0; i < count; i++) {
          airplaneMesh.getMatrixAt(i, m);
          this.airplaneVTailMesh.setMatrixAt(i, m);
        }
        if (count > 0) {
          this.airplaneVTailMesh.instanceMatrix.needsUpdate = true;
          if (this.airplaneVTailMesh.instanceColor) this.airplaneVTailMesh.instanceColor.needsUpdate = true;
        }
      }

      // Nav lights (blink)
      if (this.airplaneNavMesh) {
        this.airplaneNavMesh.count = count;
        for (let i = 0; i < count; i++) {
          airplaneMesh.getMatrixAt(i, m);
          this.airplaneNavMesh.setMatrixAt(i, m);
        }
        if (count > 0) this.airplaneNavMesh.instanceMatrix.needsUpdate = true;
        // Blink: short bright (20%), long dark (80%), follows game speed
        const blinkTime = time !== undefined ? time * (simSpeed ?? 1) : 0;
        const cycle = blinkTime % 1.0; // 1-second cycle
        this.airplaneNavMesh.visible = cycle < 0.2; // bright 0.2s, dark 0.8s
      }
    }

    // Update headlight/taillight counts and opacity
    if (this.headlightMesh && this.taillightMesh) {
      this.headlightMesh.count = lightIndex;
      this.taillightMesh.count = lightIndex;
      this.headlightMesh.instanceMatrix.needsUpdate = true;
      this.taillightMesh.instanceMatrix.needsUpdate = true;

      if (this._viewMode !== ViewMode.NORMAL) {
        if (this.headlightMaterial) this.headlightMaterial.opacity = 0;
        if (this.taillightMaterial) this.taillightMaterial.opacity = 0;
      } else {
        // Control opacity based on sun intensity
        const sun = sunIntensity ?? 1;
        const hlOpacity = Math.max(0, 0.6 * (1 - sun / 0.8));
        const tlOpacity = Math.max(0, 0.375 * (1 - sun / 0.8));
        if (this.headlightMaterial) this.headlightMaterial.opacity = hlOpacity;
        if (this.taillightMaterial) this.taillightMaterial.opacity = tlOpacity;
      }
    }
  }

  /** Switch view mode — controls per-type vehicle visibility. */
  setViewMode(mode: ViewMode): void {
    this._viewMode = mode;
    for (const [type, mesh] of this.meshes) {
      mesh.visible = getVehicleVisibility(mode, type);
    }
    const showLights = mode === ViewMode.NORMAL;
    if (this.headlightMesh) this.headlightMesh.visible = showLights;
    if (this.taillightMesh) this.taillightMesh.visible = showLights;
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.meshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();
    if (this.airplaneVTailMesh) {
      scene.remove(this.airplaneVTailMesh);
      this.airplaneVTailMesh.geometry.dispose();
      (this.airplaneVTailMesh.material as THREE.Material).dispose();
      this.airplaneVTailMesh = null;
    }
    if (this.airplaneNavMesh) {
      scene.remove(this.airplaneNavMesh);
      this.airplaneNavMesh.geometry.dispose();
      (this.airplaneNavMesh.material as THREE.Material).dispose();
      this.airplaneNavMesh = null;
    }

    if (this.headlightMesh) {
      scene.remove(this.headlightMesh);
      this.headlightMesh.geometry.dispose();
      this.headlightMaterial?.dispose();
      this.headlightMesh = null;
      this.headlightMaterial = null;
    }
    if (this.taillightMesh) {
      scene.remove(this.taillightMesh);
      this.taillightMesh.geometry.dispose();
      this.taillightMaterial?.dispose();
      this.taillightMesh = null;
      this.taillightMaterial = null;
    }
  }
}

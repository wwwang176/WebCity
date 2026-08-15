import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';

export enum OverlayType {
  NONE = 'none',
  TRAFFIC = 'traffic',
  LAND_VALUE = 'landValue',
  POLLUTION = 'pollution',
  CRIME = 'crime',
  POWER = 'power',
  WATER = 'water',
  ZONE = 'zone',
  POLICE = 'police',
  FIRE = 'fire',
  HEALTH = 'health',
  EDUCATION = 'education',
  PARK = 'park',
  GARBAGE = 'garbage',
  DISTRICT = 'district',
  COMMUTE = 'commute',
}

export interface ElevatedOverlayCell {
  x: number;
  y: number;
  /** World-space Y height for the overlay quad. */
  height: number;
  /** Overlay value (0–100). */
  value: number;
  /** Whether this cell is a ramp. */
  isRamp?: boolean;
  /** Ramp ascend direction bitmask (NESW). */
  rampAscendDirection?: number;
}

export class OverlayRenderer {
  private mesh: THREE.Mesh | null = null;
  private elevatedMesh: THREE.InstancedMesh | null = null;
  private currentOverlay: OverlayType = OverlayType.NONE;
  private readonly _reusableColor = new THREE.Color();

  /**
   * 地面覆蓋層的繪製順序。
   *
   * 建築材質是 `transparent: true`，所以建築、地面貼片與覆蓋層全在同一個透明
   * 批次裡，而 three.js 對透明物件是按**物件中心點**到鏡頭的距離排序 —— 覆蓋層
   * 是一整張蓋滿全圖的單一 mesh，中心點只有一個，所以鏡頭一轉前後關係就整批
   * 翻面：地面貼片一下被半透明色塊蓋掉、一下又冒出來。
   *
   * 排在地面細節（預設 0）之前，貼片就畫在色塊上面，玩家同時看得到「這一格的
   * 數值」與「這裡有什麼」。靠的是材質不寫深度 —— 寫了的話後面畫的貼片會被
   * 深度測試擋掉。
   */
  private static readonly GROUND_RENDER_ORDER = -1;

  getOverlay(): OverlayType {
    return this.currentOverlay;
  }

  setOverlay(
    type: OverlayType,
    scene: THREE.Scene,
    grid: Grid,
    data?: Map<string, number>,
    elevatedCells?: ElevatedOverlayCell[],
  ): void {
    this.dispose(scene);
    this.currentOverlay = type;

    if (type === OverlayType.NONE) return;

    const w = grid.width;
    const h = grid.height;
    const geometry = new THREE.PlaneGeometry(w, h, w, h);
    geometry.rotateX(-Math.PI / 2);

    const colors = new Float32Array((w + 1) * (h + 1) * 3);
    const alphas = new Float32Array((w + 1) * (h + 1));

    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const idx = j * (w + 1) + i;
        const gx = Math.min(i, w - 1);
        const gy = Math.min(j, h - 1);
        const value = data?.get(`${gx},${gy}`) ?? 0;
        const normalized = Math.min(1, Math.max(0, value / 100));

        const color = this.getColor(type, normalized);
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
        alphas[idx] = normalized * 0.6;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(w / 2 - 0.5, 0.1, h / 2 - 0.5);
    this.mesh.renderOrder = OverlayRenderer.GROUND_RENDER_ORDER;
    scene.add(this.mesh);

    // Elevated overlay: per-cell quads above elevated road surfaces
    if (elevatedCells && elevatedCells.length > 0) {
      this.buildElevatedOverlay(type, scene, elevatedCells);
    }
  }

  private static readonly RAMP_ANGLE = Math.atan2(0.6, 1.0);
  private static readonly DIR_N = 0b0001;
  private static readonly DIR_S = 0b0010;
  private static readonly DIR_E = 0b1000;
  private static readonly DIR_W = 0b0100;

  private buildElevatedOverlay(type: OverlayType, scene: THREE.Scene, cells: ElevatedOverlayCell[]): void {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(plane, mat, cells.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;

      if (c.isRamp && c.rampAscendDirection) {
        m.identity();
        const dir = c.rampAscendDirection;
        const tiltX = (dir & OverlayRenderer.DIR_N) ? OverlayRenderer.RAMP_ANGLE
          : (dir & OverlayRenderer.DIR_S) ? -OverlayRenderer.RAMP_ANGLE : 0;
        const tiltZ = (dir & OverlayRenderer.DIR_E) ? OverlayRenderer.RAMP_ANGLE
          : (dir & OverlayRenderer.DIR_W) ? -OverlayRenderer.RAMP_ANGLE : 0;
        if (tiltX !== 0) { rot.makeRotationX(tiltX); m.premultiply(rot); }
        if (tiltZ !== 0) { rot.makeRotationZ(tiltZ); m.premultiply(rot); }
        m.setPosition(c.x, c.height, c.y);
      } else {
        m.makeTranslation(c.x, c.height, c.y);
      }
      mesh.setMatrixAt(i, m);

      const normalized = Math.min(1, Math.max(0, c.value / 100));
      const color = this.getColor(type, normalized);
      mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.elevatedMesh = mesh;
    scene.add(mesh);
  }

  /** Returns a reusable Color — caller must read r/g/b before calling again. */
  private getColor(type: OverlayType, value: number): THREE.Color {
    const c = this._reusableColor;
    switch (type) {
      case OverlayType.TRAFFIC:
        return c.setHSL(0.33 - value * 0.33, 0.8, 0.5); // Green to red
      // 通勤時間：綠（走得到、搭得到）→ 紅（超過這條線就會想換工作）。
      // 刻度是絕對值不是相對最大值 —— 相對刻度會讓一座通勤全都很好的城市裡
      // 最慢的那一格照樣被畫成紅色，紅色必須永遠代表「這裡的人真的過得不好」。
      case OverlayType.COMMUTE:
        return c.setHSL(0.33 - value * 0.33, 0.75, 0.45);
      case OverlayType.LAND_VALUE:
        return c.setHSL(0.6 - value * 0.6, 0.7, 0.5); // Blue to red
      case OverlayType.POLLUTION:
        return c.setRGB(value, value * 0.3, 0); // Dark brown/orange
      case OverlayType.CRIME:
        return c.setRGB(value, 0, value * 0.5); // Purple
      case OverlayType.POWER:
        if (value >= 0.8) return c.setRGB(0.2, 0.9, 0.3);
        if (value >= 0.3) return c.setRGB(1.0, 0.8, 0.1);
        if (value > 0) return c.setRGB(0.9, 0.2, 0.15);
        return c.setRGB(0, 0, 0);
      case OverlayType.WATER:
        if (value >= 0.8) return c.setRGB(0.1, 0.5, 0.9);
        if (value >= 0.3) return c.setRGB(1.0, 0.8, 0.1);
        if (value >= 0.1) return c.setRGB(0.9, 0.2, 0.15);
        if (value > 0) return c.setRGB(0.0, 0.1 + value * 3, 0.3 + value * 5);
        return c.setRGB(0, 0, 0);
      case OverlayType.ZONE:
        return c.setRGB(value * 0.5, value, value * 0.3);
      case OverlayType.POLICE:
        return c.setRGB(0.2, 0.3, value);
      case OverlayType.FIRE:
        return c.setRGB(value, 0.15, 0.1);
      case OverlayType.HEALTH:
        return c.setRGB(value, 0.1, 0.4);
      case OverlayType.EDUCATION:
        return c.setRGB(0.4, 0.3, value * 0.6);
      case OverlayType.PARK:
        return c.setRGB(0.1, value, 0.2);
      case OverlayType.GARBAGE:
        return c.setRGB(value * 0.5, value * 0.4, 0.1);
      default:
        return c.setRGB(0.5, 0.5, 0.5);
    }
  }

  dispose(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (this.elevatedMesh) {
      scene.remove(this.elevatedMesh);
      this.elevatedMesh.geometry.dispose();
      (this.elevatedMesh.material as THREE.Material).dispose();
      this.elevatedMesh = null;
    }
  }
}

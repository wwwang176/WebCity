import * as THREE from 'three';
import { Grid } from '../core/grid/Grid';
import { DISTRICT_COLOR, DISTRICT_LABEL_LIGHTNESS } from '../core/district/DistrictPalette';

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

/** 圖層上的一個分區名稱標籤。 */
export interface DistrictLabel {
  name: string;
  /** 分區的中心格。 */
  x: number;
  y: number;
  /** 這一區的圖層數值（1–100）—— 標籤的底色用它，跟腳下的色塊對得起來。 */
  value: number;
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
  private readonly labelSprites: THREE.Sprite[] = [];
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
    labels?: DistrictLabel[],
  ): void {
    this.dispose(scene);
    this.currentOverlay = type;

    if (type === OverlayType.NONE) return;

    // 尺寸由 `updateLabelScale` 給 —— 建完先套一次，不然第一幀之前是零大小。
    if (labels?.length) this.buildLabels(scene, labels);

    const w = grid.width;
    const h = grid.height;
    // 一格一個頂點，頂點落在格子**中心**上。
    //
    // 顏色是逐頂點給的，所以頂點在哪裡，那個顏色就出現在哪裡。原本鋪的是
    // `PlaneGeometry(w, h, w, h)` —— (w+1)×(h+1) 個頂點落在格子的**角**上
    // （世界座標 `i-0.5`），卻塞進格 (i,j) 的顏色，於是整張色場往 −x、−z 各偏
    // 半格，在等角視角下看起來就是整片往西北挪了半格。
    //
    // 少一段就讓頂點正好落在 0..w-1 的整數上，跟建築、游標、分區外框同一套座標。
    // 代價是最外圈半格沒有色塊 —— 色塊鋪到邊界格的中心線為止。四邊對稱，而往
    // 東南推半格的另一種修法會讓半格懸在地形外面（地形只鋪到 w-0.5）。
    const geometry = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
    geometry.rotateX(-Math.PI / 2);

    // 頂點色帶第四個分量。three.js 看到 itemSize 4 的 color 屬性就會啟用逐頂點
    // 透明度；只有 RGB 的話材質就只剩一個統一的 `opacity`，於是**值為 0 的格子
    // 也照樣被塗**成 `getColor(type, 0)`，整張地圖蓋一層均勻的色。
    //
    // 濃度是二元的，不隨數值等比縮放：多數圖層的數值是分類而非強度 —— 缺電是
    // 15、供電不足是 50、正常是 100。等比縮放會讓最該看到的紅色警告淡到幾乎
    // 不見，而「一切正常」反而最顯眼。
    const colors = new Float32Array(w * h * 4);

    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const idx = (j * w + i) * 4;
        const value = data?.get(`${i},${j}`) ?? 0;
        const normalized = Math.min(1, Math.max(0, value / 100));

        const color = this.getColor(type, normalized);
        colors[idx] = color.r;
        colors[idx + 1] = color.g;
        colors[idx + 2] = color.b;
        colors[idx + 3] = value > 0 ? 1 : 0;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set((w - 1) / 2, 0.1, (h - 1) / 2);
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

  /**
   * 一個圖層數值（0–100）在這張圖層上的顏色。
   *
   * 給地面**以外**的東西用 —— 建築壓在色塊上，只看得到屋頂的街廓要拿同一個顏色
   * 才說得出腳下那一格是什麼。顏色不能兩邊各算一次:改了一邊另一邊就不一樣。
   */
  colorFor(type: OverlayType, value: number): number {
    return this.getColor(type, Math.min(1, Math.max(0, value / 100))).getHex();
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
      // 分區的數值是身分不是強度 —— builder 給每個分區一個 20–99 的雜湊值，
      // 這裡把它當色相用。分區數量沒有上限，用色相環才分得開相鄰的兩區；
      // 換成明度或單一色相的深淺，第三個分區就跟第一個看起來一樣了。
      case OverlayType.DISTRICT:
        return c.setHSL(value, DISTRICT_COLOR.saturation, DISTRICT_COLOR.lightness);
      default:
        return c.setRGB(0.5, 0.5, 0.5);
    }
  }

  /**
   * 名稱標籤。
   *
   * 用 sprite 而不是 DOM:sprite 跟著場景走，開關圖層時跟色塊一起生一起滅，不必
   * 每一幀把世界座標投影回螢幕。
   */
  private buildLabels(scene: THREE.Scene, labels: DistrictLabel[]): void {
    for (const label of labels) {
      const sprite = makeLabelSprite(label);
      // 疊在色塊上方一點，不然會被地面 z-fight 吃掉。
      // 格子中心落在整數上（建築、游標、分區外框都是），不是 +0.5 的角上。
      sprite.position.set(label.x, LABEL_HEIGHT, label.y);
      scene.add(sprite);
      this.labelSprites.push(sprite);
    }
  }

  /**
   * 讓標籤在螢幕上維持固定大小。
   *
   * 這是正交相機，縮放做在可視範圍上（`camera.top - camera.bottom`），所以世界裡
   * 固定大小的東西在螢幕上會隨著拉近而變大。分區名稱不該這樣 —— 它是地圖上的
   * 標示，不是場景裡的物件。世界尺度因此要跟可視範圍等比。
   */
  updateLabelScale(camera: THREE.OrthographicCamera): void {
    if (this.labelSprites.length === 0) return;
    const frustum = camera.top - camera.bottom;
    const height = LABEL_WORLD_HEIGHT * (frustum / LABEL_REFERENCE_FRUSTUM);
    for (const sprite of this.labelSprites) {
      const aspect = (sprite.userData.aspect as number) || 1;
      sprite.scale.set(height * aspect, height, 1);
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const s of this.labelSprites) {
      scene.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.labelSprites.length = 0;

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


/** 標籤浮在地面上方的高度。低於色塊的話會被地面吃掉。 */
const LABEL_HEIGHT = 1.2;

/**
 * 標籤在**參考可視範圍**下的世界高度（格）。
 *
 * 只是個基準:`updateLabelScale` 會照目前的可視範圍等比換算，讓標籤在螢幕上的大小
 * 固定。分區名稱是地圖上的標示，不是場景裡的物件 —— 拉近看城市細節時，名稱跟著
 * 放大只會擋住你正要看的東西。
 */
const LABEL_WORLD_HEIGHT = 0.95;

/** `LABEL_WORLD_HEIGHT` 是在這個可視範圍下量的。跟 `SCENE.FRUSTUM_SIZE` 是同一個數。 */
const LABEL_REFERENCE_FRUSTUM = 60;

/**
 * 把名字畫成一張貼圖。
 *
 * 底色用該分區的圖層顏色，字用白色加深色描邊 —— 色相環轉一圈總有幾個顏色會讓
 * 純白的字看不清楚。
 */
function makeLabelSprite(label: DistrictLabel): THREE.Sprite {
  const pad = 12;
  const font = 'bold 44px sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const textWidth = measure.measureText(label.name).width;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth) + pad * 2;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = `hsl(${(label.value / 100) * 360} ${DISTRICT_COLOR.saturation * 100}% ${DISTRICT_LABEL_LIGHTNESS * 100}%)`;
  ctx.globalAlpha = 0.55;
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(label.name, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(label.name, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    // 整張貼圖再壓一次透明度:名稱是疊在地圖上的標示，蓋掉底下的地形就本末倒置。
    // 字仍然帶深色描邊，淡下去之後才不會糊在底色裡。
    map: texture, transparent: true, depthTest: false, opacity: 0.8,
  }));
  // 寬度照貼圖比例 —— 名字長就寬一點，字不會被壓扁。實際尺寸由
  // `updateLabelScale` 決定，它才知道現在的可視範圍。
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

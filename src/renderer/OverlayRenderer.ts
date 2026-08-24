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

/** One district name label on the overlay. */
export interface DistrictLabel {
  name: string;
  /** The district's centre cell. */
  x: number;
  y: number;
  /** This district's overlay value (1-100). The label's background uses it so it matches the patch beneath. */
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
   * Render order of the ground overlay.
   *
   * The building material is `transparent: true`, so buildings, ground decals and the overlay
   * all share one transparent batch, and three.js sorts transparent objects by the distance from
   * the camera to an **object's centre**. The overlay is a single mesh covering the whole map
   * with one centre, so turning the camera flips the whole ordering at once: ground decals are
   * covered by the translucent patches one moment and reappear the next.
   *
   * Ordered before ground detail (default 0), decals draw on top of the patches and the player
   * sees both this cell's value and what stands on it. That relies on the material not writing
   * depth; writing it, the later decals would be rejected by the depth test.
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

    // The size comes from `updateLabelScale`; it is applied once after building, or the labels
    // are zero-sized until the first frame.
    if (labels?.length) this.buildLabels(scene, labels);

    const w = grid.width;
    const h = grid.height;
    // One vertex per cell, landing on the cell's **centre**.
    //
    // Colours are given per vertex, so a colour appears wherever its vertex is.
    // `PlaneGeometry(w, h, w, h)` puts (w+1)x(h+1) vertices on the cells' **corners** (world
    // coordinate `i-0.5`) while carrying cell (i,j)'s colour, shifting the whole colour field
    // half a cell along -x and -z, which in an isometric view reads as the entire overlay moved
    // half a cell to the north-west.
    //
    // One segment fewer puts the vertices exactly on the integers 0..w-1, the same coordinates
    // buildings, the cursor and district outlines use. The cost is half a cell with no patch
    // around the outside: the patches reach the boundary cells' centre lines. That is symmetric
    // on all four sides, while pushing half a cell south-east instead would leave half a cell
    // hanging off the terrain, which only reaches w-0.5.
    const geometry = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
    geometry.rotateX(-Math.PI / 2);

    // The vertex colours carry a fourth component. three.js enables per-vertex alpha when it
    // sees a colour attribute with itemSize 4; with RGB only, the material has a single uniform
    // `opacity` and **cells whose value is 0 are painted too**, in `getColor(type, 0)`, laying a
    // uniform wash over the whole map.
    //
    // The alpha is binary rather than proportional to the value: most overlays' values are
    // categories rather than intensities — no power is 15, undersupplied is 50, healthy is 100.
    // Scaled proportionally, the red warnings that most need seeing fade to almost nothing while
    // "everything is fine" is the most prominent thing on screen.
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
   * An overlay value's (0-100) colour on this overlay.
   *
   * For everything **other than** the ground: buildings stand on the patches, and a block that
   * shows only rooftops needs the same colour to say what the cell beneath it is. The colour must
   * not be computed on both sides, or changing one leaves the other behind.
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
      // Commute time: green (walkable, reachable by transit) to red (past this line people
      // start looking for another job). The scale is absolute rather than relative to the
      // maximum: a relative scale would redden the slowest cell even in a city with uniformly
      // good commutes, and red has to always mean these residents are genuinely badly off.
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
      // A district's value is an identity rather than an intensity: the builder gives each
      // district a value in 20-99 and this uses it as a hue. There is no cap on the number of
      // districts, and only a hue wheel keeps two neighbours apart; with brightness or shades of
      // one hue, the third district already looks like the first.
      case OverlayType.DISTRICT:
        return c.setHSL(value, DISTRICT_COLOR.saturation, DISTRICT_COLOR.lightness);
      default:
        return c.setRGB(0.5, 0.5, 0.5);
    }
  }

  /**
   * The name labels.
   *
   * Sprites rather than DOM: a sprite lives in the scene, is created and destroyed with the
   * patches as the overlay opens and closes, and needs no per-frame projection of world
   * coordinates back to the screen.
   */
  private buildLabels(scene: THREE.Scene, labels: DistrictLabel[]): void {
    for (const label of labels) {
      const sprite = makeLabelSprite(label);
      // Slightly above the patches, or the ground z-fights it away. Cell centres land on
      // integers, as they do for buildings, the cursor and district outlines, rather than on the
      // +0.5 corners.
      sprite.position.set(label.x, LABEL_HEIGHT, label.y);
      sprite.renderOrder = LABEL_RENDER_ORDER;
      scene.add(sprite);
      this.labelSprites.push(sprite);
    }
  }

  /**
   * Keeps labels at a fixed size on screen.
   *
   * This is an orthographic camera, whose zoom acts on the visible range
   * (`camera.top - camera.bottom`), so something of fixed size in the world grows on screen as
   * the camera closes in. A district name should not: it is a map annotation, not an object in
   * the scene. So its world size scales with the visible range.
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


/** How far a label floats above the ground. Below the patches, the ground swallows it. */
const LABEL_HEIGHT = 1.2;

/**
 * Labels draw after the whole city.
 *
 * The material is already `depthTest: false`, but that only guarantees nothing drawn **earlier**
 * covers it; it does not stop something drawn **later** painting over it. The building material
 * is `transparent: true`, so it shares the label's queue, and with both at `renderOrder` 0 the
 * order falls to three.js's depth sort.
 *
 * That sort uses an **object's origin** in view space rather than the range it occupies. The
 * whole city is one `InstancedMesh` whose origin stays at the world origin, the map's
 * north-west corner, so it sorts as far away as that corner; infrastructure is a Group per cell
 * with its own `position` and sorts by its real location. Both end up behind labels at some
 * camera angles, and the larger the map and the further a label from the origin, the more likely
 * it is (BUG-315).
 *
 * 900 deliberately stays below `BuildingRenderer`'s no-power and no-water warnings at 999: those
 * icons are small, and a translucent name plate covering one is worse than a building covering
 * the name plate.
 */
const LABEL_RENDER_ORDER = 900;

/**
 * A label's world height, in cells, at the **reference visible range**.
 *
 * Only a baseline: `updateLabelScale` rescales it against the current visible range so the label
 * keeps a fixed size on screen. A district name is a map annotation, not an object in the scene
 * — closing in on the city's detail, a name that grows with it only covers what you came to look
 * at.
 */
const LABEL_WORLD_HEIGHT = 0.95;

/** The visible range `LABEL_WORLD_HEIGHT` was measured at. The same number as `SCENE.FRUSTUM_SIZE`. */
const LABEL_REFERENCE_FRUSTUM = 60;

/**
 * Draws a name into a texture.
 *
 * The background takes the district's overlay colour and the text is white with a dark outline:
 * somewhere around the hue wheel there are always colours that leave plain white text
 * illegible.
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
    // The whole texture is faded once more: a name is an annotation laid over the map, and
    // hiding the terrain beneath it defeats the point. The text keeps its dark outline so it does
    // not blur into the background once faded.
    map: texture, transparent: true, depthTest: false, opacity: 0.8,
  }));
  // The width follows the texture's aspect, so a longer name is wider and the text is not
  // squashed. The actual size comes from `updateLabelScale`, which knows the current visible
  // range.
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

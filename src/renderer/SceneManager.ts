import * as THREE from 'three';
import { shadowDepthRange } from './shadowFit';

/** Scene setup constants */
export const SCENE = {
  SKY_COLOR: 0x87ceeb,
  FRUSTUM_SIZE: 60,
  NEAR_CLIP: 0.1,
  FAR_CLIP: 1000,
  CAMERA_ANGLE: Math.PI / 4,
  CAMERA_ELEVATION: Math.PI / 6,
  CAMERA_DISTANCE: 50,
  SUN_OFFSET: { x: 50, y: 80, z: 50 },
  AMBIENT_INTENSITY: 0.6,
  DIRECTIONAL_INTENSITY: 0.8,
  HEMISPHERE_INTENSITY: 0.3,
  HEMISPHERE_GROUND: 0x556633,
  SHADOW_MAP_SIZE: 2048,
  /**
   * The offset in depth space. **A world distance takes it times (far - near)**, which is where it
   * is most easily underestimated: -0.0005 with a hard-coded near 1 and far 200 pushes
   * `0.0005 x 199 = 0.1 cells = 1.2 m` along the light axis, sending the shadow more than 2 m away
   * on the ground. Fixing `normalBias` alone leaves that untouched, and it accounts for under a
   * tenth of the offset.
   *
   * near and far now shrink with the shadow camera each frame (see `shadowFit.shadowDepthRange`),
   * and this value itself is below the magnitude three.js's documentation suggests. Preventing acne
   * is `normalBias`'s job, which is newer and far less prone to peter-panning.
   */
  SHADOW_BIAS: -0.00002,
  /**
   * How far a receiving surface is pushed along its normal, in **world units** where 1 unit is 12 m.
   *
   * 0.02 is a common value in three.js examples, but those scenes use 1 unit per metre, where it is
   * 2 cm. Here it is **24 cm**, and with the ground's normal pointing up the shadow slides along it
   * by `0.24 / tan(48.5 degrees)` ~ 21 cm: wider than a street lamp's post itself, which is 14 to
   * 18 cm across, so the shadow visibly separates from the post's foot (BUG-234).
   *
   * 0.005 is 6 cm, for a ground offset of about 5 cm. It cannot be zero, which grows self-shadowing
   * stripes — shadow acne — across flat ground.
   */
  SHADOW_NORMAL_BIAS: 0.005,
  SHADOW_NEAR: 1,
  SHADOW_FAR: 200,
  SHADOW_EXTENT: 60,
} as const;

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  private animationId = 0;
  private callbacks: ((dt: number) => void)[] = [];
  private lastTime = 0;

  // Lights (public for weather/day-night control)
  readonly ambientLight!: THREE.AmbientLight;
  readonly directionalLight!: THREE.DirectionalLight;
  readonly hemisphereLight!: THREE.HemisphereLight;

  // Sun offset – set by WeatherRenderer, applied relative to cameraTarget
  readonly sunOffset = new THREE.Vector3(SCENE.SUN_OFFSET.x, SCENE.SUN_OFFSET.y, SCENE.SUN_OFFSET.z);

  // Camera state
  private cameraAngle = SCENE.CAMERA_ANGLE;
  private targetCameraAngle = SCENE.CAMERA_ANGLE;
  private cameraDistance = SCENE.CAMERA_DISTANCE;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private cameraElevation = SCENE.CAMERA_ELEVATION;
  private targetCameraElevation = SCENE.CAMERA_ELEVATION;
  private static readonly DEFAULT_ELEVATION = SCENE.CAMERA_ELEVATION;

  // Reusable vectors for panCamera (avoid per-call allocation)
  private readonly _panForward = new THREE.Vector3();
  private readonly _panRight = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE.SKY_COLOR);

    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = SCENE.FRUSTUM_SIZE;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      SCENE.NEAR_CLIP,
      SCENE.FAR_CLIP,
    );
    this.updateCameraPosition();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Lights
    this.setupLights();

    // Resize handler — preserve current zoom (top/bottom), only adjust aspect ratio (left/right)
    window.addEventListener('resize', () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const a = w / h;
      const fs = (this.camera.top - this.camera.bottom) || 60;
      this.camera.left = -fs * a / 2;
      this.camera.right = fs * a / 2;
      // Keep top/bottom unchanged to preserve zoom level
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  private setupLights(): void {
    // Use Object.defineProperty to assign readonly properties from helper method
    const self = this as SceneManager;

    Object.defineProperty(self, 'ambientLight', {
      value: new THREE.AmbientLight(0xffffff, SCENE.AMBIENT_INTENSITY),
      writable: false,
    });
    this.scene.add(this.ambientLight);

    const dir = new THREE.DirectionalLight(0xffffff, SCENE.DIRECTIONAL_INTENSITY);
    dir.position.set(SCENE.SUN_OFFSET.x, SCENE.SUN_OFFSET.y, SCENE.SUN_OFFSET.z);
    dir.castShadow = true;
    dir.shadow.mapSize.width = SCENE.SHADOW_MAP_SIZE;
    dir.shadow.mapSize.height = SCENE.SHADOW_MAP_SIZE;
    dir.shadow.bias = SCENE.SHADOW_BIAS;
    dir.shadow.normalBias = SCENE.SHADOW_NORMAL_BIAS;
    dir.shadow.camera.near = SCENE.SHADOW_NEAR;
    dir.shadow.camera.far = SCENE.SHADOW_FAR;
    dir.shadow.camera.left = -SCENE.SHADOW_EXTENT;
    dir.shadow.camera.right = SCENE.SHADOW_EXTENT;
    dir.shadow.camera.top = SCENE.SHADOW_EXTENT;
    dir.shadow.camera.bottom = -SCENE.SHADOW_EXTENT;
    Object.defineProperty(self, 'directionalLight', {
      value: dir,
      writable: false,
    });
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);

    Object.defineProperty(self, 'hemisphereLight', {
      value: new THREE.HemisphereLight(SCENE.SKY_COLOR, SCENE.HEMISPHERE_GROUND, SCENE.HEMISPHERE_INTENSITY),
      writable: false,
    });
    this.scene.add(this.hemisphereLight);
  }

  private updateCameraPosition(): void {
    const x = this.cameraDistance * Math.cos(this.cameraElevation) * Math.cos(this.cameraAngle);
    const y = this.cameraDistance * Math.sin(this.cameraElevation);
    const z = this.cameraDistance * Math.cos(this.cameraElevation) * Math.sin(this.cameraAngle);
    this.camera.position.set(
      this.cameraTarget.x + x,
      this.cameraTarget.y + y,
      this.cameraTarget.z + z,
    );
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  getCameraTarget(): THREE.Vector3 {
    return this.cameraTarget;
  }

  setCameraTarget(x: number, z: number): void {
    this.cameraTarget.x = x;
    this.cameraTarget.z = z;
    this.updateCameraPosition();
  }

  panCamera(dx: number, dz: number): void {
    this._panForward.set(Math.cos(this.cameraAngle), 0, Math.sin(this.cameraAngle));
    this._panRight.set(Math.sin(this.cameraAngle), 0, -Math.cos(this.cameraAngle));
    this.cameraTarget.addScaledVector(this._panRight, dx);
    this.cameraTarget.addScaledVector(this._panForward, dz);
    // Clamp camera target to map bounds with small margin
    const margin = 10;
    this.cameraTarget.x = Math.max(-margin, Math.min(60 + margin, this.cameraTarget.x));
    this.cameraTarget.z = Math.max(-margin, Math.min(60 + margin, this.cameraTarget.z));
    this.updateCameraPosition();
  }

  rotateCamera(deltaAngle: number): void {
    // Always find the next 45° grid point in the pressed direction
    // Use targetCameraAngle (not cameraAngle) so rapid presses accumulate
    const step = Math.PI / 4;
    const current = this.targetCameraAngle;
    const snapped = deltaAngle > 0
      ? Math.floor(current / step + 1) * step
      : Math.ceil(current / step - 1) * step;
    this.targetCameraAngle = snapped;
    // Also reset elevation to default
    this.targetCameraElevation = SceneManager.DEFAULT_ELEVATION;
  }

  /** Immediate rotation + elevation change (middle-mouse drag). */
  orbitCamera(deltaAngle: number, deltaElevation: number): void {
    this.cameraAngle += deltaAngle;
    this.targetCameraAngle = this.cameraAngle;
    this.cameraElevation = Math.max(Math.PI / 18, Math.min(Math.PI * 4 / 9, this.cameraElevation + deltaElevation));
    this.targetCameraElevation = this.cameraElevation;
    this.updateCameraPosition();
  }

  /**
   * The camera's complete state: which cell it looks at, how many cells fit on screen, and its
   * azimuth and elevation.
   *
   * `size` is the **orthographic frustum's height**, not a camera distance: this is an orthographic
   * projection, and changing `cameraDistance` barely affects the visible size and only moves the
   * clipping planes.
   */
  getCameraState(): { x: number; y: number; size: number; angle: number; elevation: number } {
    const t = this.cameraTarget;
    return {
      x: t.x,
      y: t.z,
      size: (this.camera.top - this.camera.bottom) || 60,
      angle: this.cameraAngle,
      elevation: this.cameraElevation,
    };
  }

  /**
   * Sets the camera. Omitted fields are left alone.
   *
   * The clamps deliberately match what a player's own controls allow — `zoomCamera`'s 3 to 200 and
   * `orbitCamera`'s pi/18 to 4pi/9 — so any angle a program can frame is one a player can reach.
   */
  setCameraState(t: { x?: number; y?: number; size?: number; angle?: number; elevation?: number }): void {
    if (t.size !== undefined) {
      const current = (this.camera.top - this.camera.bottom) || 60;
      this.zoomCamera(Math.max(3, Math.min(200, t.size)) - current);
    }
    if (t.x !== undefined || t.y !== undefined) {
      const now = this.cameraTarget;
      this.setCameraTarget(t.x ?? now.x, t.y ?? now.z);
    }
    if (t.angle !== undefined) {
      this.cameraAngle = t.angle;
      this.targetCameraAngle = t.angle;
    }
    if (t.elevation !== undefined) {
      const e = Math.max(Math.PI / 18, Math.min(Math.PI * 4 / 9, t.elevation));
      this.cameraElevation = e;
      this.targetCameraElevation = e;
    }
    this.updateCameraPosition();
  }

  zoomCamera(delta: number): void {
    const currentSize = (this.camera.top - this.camera.bottom) || 60;
    const aspect = this.camera.right / (this.camera.top || 1);
    const newSize = Math.max(3, Math.min(200, currentSize + delta));
    this.camera.left = -newSize * aspect / 2;
    this.camera.right = newSize * aspect / 2;
    this.camera.top = newSize / 2;
    this.camera.bottom = -newSize / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Fit shadow camera to the visible area so the shadow map is used efficiently. */
  private updateShadowCamera(): void {
    // Position light relative to camera target
    this.directionalLight.position.set(
      this.cameraTarget.x + this.sunOffset.x,
      this.sunOffset.y,
      this.cameraTarget.z + this.sunOffset.z,
    );
    this.directionalLight.target.position.copy(this.cameraTarget);

    // Shadow camera covers the visible orthographic frustum + padding
    const halfW = (this.camera.right - this.camera.left) / 2;
    const halfH = (this.camera.top - this.camera.bottom) / 2;
    const extent = Math.max(halfW, halfH);
    const padded = extent * 1.3; // 30% extra for off-screen casters

    const sc = this.directionalLight.shadow.camera;
    sc.left = -padded;
    sc.right = padded;
    sc.top = padded;
    sc.bottom = -padded;

    // The depth range shrinks with it. `shadow.bias` is a value in [0, 1] depth space and a world
    // distance is bias times (far - near): the wider the range, the further the shadow is pushed
    // from its object. A hard-coded 1 / 200 gives 199 cells = 2388 m while the light is only about
    // 107 cells from the focus.
    const { near, far } = shadowDepthRange(this.sunOffset.length(), padded);
    sc.near = near;
    sc.far = far;
    sc.updateProjectionMatrix();
  }

  onUpdate(callback: (dt: number) => void): void {
    this.callbacks.push(callback);
  }

  start(): void {
    this.lastTime = performance.now();
    const animate = (time: number) => {
      this.animationId = requestAnimationFrame(animate);
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      // Smoothly interpolate camera rotation and elevation
      const angleDiff = this.targetCameraAngle - this.cameraAngle;
      const elevDiff = this.targetCameraElevation - this.cameraElevation;
      if (Math.abs(angleDiff) > 0.001 || Math.abs(elevDiff) > 0.001) {
        const speed = 8; // higher = faster transition
        this.cameraAngle += angleDiff * Math.min(1, speed * dt);
        this.cameraElevation += elevDiff * Math.min(1, speed * dt);
        this.updateCameraPosition();
      }
      for (const cb of this.callbacks) cb(dt);
      this.updateShadowCamera();
      this.renderer.render(this.scene, this.camera);
    };
    this.animationId = requestAnimationFrame(animate);
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}

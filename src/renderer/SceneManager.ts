import * as THREE from 'three';

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
  readonly sunOffset = new THREE.Vector3(50, 80, 50);

  // Camera state
  private cameraAngle = Math.PI / 4; // 45 degrees isometric
  private targetCameraAngle = Math.PI / 4;
  private cameraDistance = 50;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private cameraElevation = Math.PI / 6; // 30 degrees
  private targetCameraElevation = Math.PI / 6;
  private static readonly DEFAULT_ELEVATION = Math.PI / 6;

  // Reusable vectors for panCamera (avoid per-call allocation)
  private readonly _panForward = new THREE.Vector3();
  private readonly _panRight = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue

    // Orthographic camera for isometric view
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 60;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000,
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
      value: new THREE.AmbientLight(0xffffff, 0.6),
      writable: false,
    });
    this.scene.add(this.ambientLight);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 80, 50);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.02;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 200;
    dir.shadow.camera.left = -60;
    dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 60;
    dir.shadow.camera.bottom = -60;
    Object.defineProperty(self, 'directionalLight', {
      value: dir,
      writable: false,
    });
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);

    Object.defineProperty(self, 'hemisphereLight', {
      value: new THREE.HemisphereLight(0x87ceeb, 0x556633, 0.3),
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
    const step = Math.PI / 4;
    const current = this.cameraAngle;
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

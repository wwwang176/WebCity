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

  // Camera state
  private cameraAngle = Math.PI / 4; // 45 degrees isometric
  private cameraDistance = 50;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private cameraElevation = Math.PI / 6; // 30 degrees

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

    // Resize handler
    window.addEventListener('resize', () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const a = w / h;
      const fs = 60;
      this.camera.left = -fs * a / 2;
      this.camera.right = fs * a / 2;
      this.camera.top = fs / 2;
      this.camera.bottom = -fs / 2;
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
    dir.shadow.camera.left = -100;
    dir.shadow.camera.right = 100;
    dir.shadow.camera.top = 100;
    dir.shadow.camera.bottom = -100;
    Object.defineProperty(self, 'directionalLight', {
      value: dir,
      writable: false,
    });
    this.scene.add(this.directionalLight);

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

  panCamera(dx: number, dz: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.cameraAngle), 0, Math.cos(this.cameraAngle));
    const right = new THREE.Vector3(Math.cos(this.cameraAngle), 0, Math.sin(this.cameraAngle));
    this.cameraTarget.addScaledVector(right, dx);
    this.cameraTarget.addScaledVector(forward, dz);
    // Clamp camera target to map bounds with small margin
    const margin = 10;
    this.cameraTarget.x = Math.max(-margin, Math.min(60 + margin, this.cameraTarget.x));
    this.cameraTarget.z = Math.max(-margin, Math.min(60 + margin, this.cameraTarget.z));
    this.updateCameraPosition();
  }

  rotateCamera(deltaAngle: number): void {
    this.cameraAngle += deltaAngle;
    this.updateCameraPosition();
  }

  zoomCamera(delta: number): void {
    const frustumSize = 60;
    const aspect = this.camera.right / (this.camera.top || 1);
    const newSize = Math.max(10, Math.min(200, frustumSize + delta));
    this.camera.left = -newSize * aspect / 2;
    this.camera.right = newSize * aspect / 2;
    this.camera.top = newSize / 2;
    this.camera.bottom = -newSize / 2;
    this.camera.updateProjectionMatrix();
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
      for (const cb of this.callbacks) cb(dt);
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

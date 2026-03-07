import * as THREE from 'three';

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  private animationId = 0;
  private callbacks: ((dt: number) => void)[] = [];
  private lastTime = 0;

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
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(50, 80, 50);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.camera.left = -100;
    directional.shadow.camera.right = 100;
    directional.shadow.camera.top = 100;
    directional.shadow.camera.bottom = -100;
    this.scene.add(directional);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556633, 0.3);
    this.scene.add(hemi);
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

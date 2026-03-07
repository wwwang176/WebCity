import * as THREE from 'three';

export interface GridCoord {
  x: number;
  y: number;
}

export class InputManager {
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private gridWidth: number;
  private gridHeight: number;

  constructor(canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera, gridWidth: number, gridHeight: number) {
    this.canvas = canvas;
    this.camera = camera;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
  }

  screenToGrid(screenX: number, screenY: number): GridCoord | null {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, intersection);

    if (!intersection) return null;

    const gx = Math.round(intersection.x);
    const gy = Math.round(intersection.z);

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) return null;

    return { x: gx, y: gy };
  }
}

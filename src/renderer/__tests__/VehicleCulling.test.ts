import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleRenderer, type VehicleData } from '../VehicleRenderer';

/**
 * Vehicles that cannot be seen are not sent to the GPU.
 *
 * Every vehicle mesh sets `frustumCulled = false`, which is correct for an `InstancedMesh` — the
 * batch shares one bounding box and three.js cannot judge instances individually — at the cost of
 * a full 2000 vehicles each transforming vertices every frame, even with the camera on the far side
 * of the city. At 120 triangles per vehicle that is 240,000, more than the rest of the scene
 * combined.
 *
 * The criterion is **the camera's frustum** rather than a fixed distance from its target.
 * Pedestrians use a fixed radius of 15 (`cullPedestrians`), and copying that leaves vehicles
 * appearing only in a small circle at the screen's centre as soon as the camera pulls back — worse
 * than the original problem.
 *
 * Culling happens on the rendering side only. The simulation knows nothing of it: a culled vehicle
 * still drives and still occupies its place and is merely not drawn — and it is off screen, so
 * "a vehicle braking for empty road" does not come back (BUG-262).
 */

const ASPECT = 16 / 9;

/** An isometric camera aimed at `target`, with a visible height of `frustumSize` cells. */
function isoCamera(target: { x: number; z: number }, frustumSize: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(
    -frustumSize * ASPECT / 2, frustumSize * ASPECT / 2,
    frustumSize / 2, -frustumSize / 2,
    0.1, 2000,
  );
  const dist = 200;
  const elev = Math.PI / 5;
  const ang = Math.PI / 4;
  cam.position.set(
    target.x + dist * Math.cos(elev) * Math.cos(ang),
    dist * Math.sin(elev),
    target.z + dist * Math.cos(elev) * Math.sin(ang),
  );
  cam.lookAt(target.x, 0, target.z);
  cam.updateMatrixWorld(true);
  return cam;
}

function car(id: number, x: number, z: number): VehicleData {
  return { id, x, y: z, heading: 0, type: 'car', laneOffset: 0 };
}

/** An n-by-n block of vehicles centred at (cx, cz), one cell apart. */
function block(idBase: number, cx: number, cz: number, n: number): VehicleData[] {
  const out: VehicleData[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push(car(idBase + i * n + j, cx - n / 2 + i, cz - n / 2 + j));
    }
  }
  return out;
}

function bodyMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.castShadow,
  );
}

function lightMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.renderOrder === 10,
  );
}

function effective(mesh: THREE.InstancedMesh): number {
  return Math.min(mesh.count, mesh.instanceMatrix.count);
}

function drawnCount(scene: THREE.Scene): number {
  return bodyMeshes(scene).reduce((n, m) => n + effective(m), 0);
}

/** Every drawn instance's world position. */
function drawnPositions(scene: THREE.Scene): Array<{ x: number; z: number }> {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: Array<{ x: number; z: number }> = [];
  for (const mesh of bodyMeshes(scene)) {
    for (let i = 0; i < effective(mesh); i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
}

function setup(): { scene: THREE.Scene; renderer: VehicleRenderer } {
  const scene = new THREE.Scene();
  const renderer = new VehicleRenderer();
  renderer.build(scene);
  return { scene, renderer };
}

describe('車輛的視錐剔除', () => {
  it('should draw everything when no camera has been set', () => {
    // The showcase and other callers with no camera must not lose anything to this.
    const { scene, renderer } = setup();
    const list = [...block(1, 0, 0, 10), ...block(1000, 400, 400, 10)];
    renderer.update(list);
    expect(drawnCount(scene), '沒有鏡頭時就不該剔除').toBe(list.length);
  });

  it('should skip vehicles the camera cannot see', () => {
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const near = block(1, 0, 0, 6);
    const far = block(1000, 500, 500, 12);
    renderer.update([...near, ...far]);

    expect(drawnCount(scene), '畫面外的車還是送進去了').toBe(near.length);
  });

  it('should draw the vehicles it keeps at the right places', () => {
    // With some skipped in the middle, the rest have to refill the instance indices contiguously:
    // a hole leaves a vehicle parked at the origin, or one vehicle's matrix overwritten by the
    // next.
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const list = [
      car(1, 0, 0),
      car(2, 600, 600),   // off screen
      car(3, 2, 2),
      car(4, -700, 400),  // off screen
      car(5, -3, 1),
    ];
    renderer.update(list);

    const drawn = drawnPositions(scene);
    expect(drawn.length, '留下的台數不對').toBe(3);
    for (const p of drawn) {
      expect(Math.abs(p.x) < 10 && Math.abs(p.z) < 10,
        `畫在 (${p.x}, ${p.z}) —— 那不是任何一台看得見的車`).toBe(true);
    }
  });

  it('should reveal more vehicles as the camera zooms out', () => {
    // This guards against copying the pedestrians' fixed radius. At a fixed radius, pulling the
    // camera back changes the count not at all: the view grows while the vehicles stay in a small
    // circle at its centre.
    const { scene, renderer } = setup();
    const spread = block(1, 0, 0, 40);   // 40x40 cells, far larger than any one view

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 20));
    renderer.update(spread);
    const zoomedIn = drawnCount(scene);

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 60));
    renderer.update(spread);
    const zoomedOut = drawnCount(scene);

    expect(zoomedIn, '近景一台都沒看到').toBeGreaterThan(0);
    expect(zoomedIn, '近景反而全畫了 —— 根本沒有剔除').toBeLessThan(spread.length);
    expect(zoomedOut, '鏡頭拉遠卻沒有看到更多車').toBeGreaterThan(zoomedIn);
  });

  it('should follow the camera when it pans', () => {
    const { scene, renderer } = setup();
    const here = block(1, 0, 0, 6);
    const there = block(1000, 300, 300, 6);
    const list = [...here, ...there];

    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    renderer.update(list);
    for (const p of drawnPositions(scene)) {
      expect(Math.abs(p.x) < 50, '鏡頭在原點卻畫了遠處那一片').toBe(true);
    }

    renderer.setCullCamera(isoCamera({ x: 300, z: 300 }, 40));
    renderer.update(list);
    const after = drawnPositions(scene);
    expect(after.length, '鏡頭移過去之後那一片沒有出現').toBe(there.length);
    for (const p of after) {
      expect(p.x > 250, '鏡頭移走了還在畫原點那一片').toBe(true);
    }
  });

  it('should keep a margin so vehicles do not pop at the screen edge', () => {
    // A vehicle right on the boundary is kept. The frustum is the **screen's** boundary, and a
    // vehicle has volume and casts a shadow: one just outside can have its shadow inside.
    const { scene, renderer } = setup();
    const cam = isoCamera({ x: 0, z: 0 }, 40);

    // The exact screen boundary: the last position along +x still inside the frustum. Computed here
    // rather than asked of the renderer — using the renderer's own criterion as the threshold stays
    // green with the margin set to 0.
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    const p = new THREE.Vector3();
    let edge = 0;
    for (let d = 0; d < 400; d++) {
      if (!frustum.containsPoint(p.set(d, 0, 0))) break;
      edge = d;
    }

    renderer.setCullCamera(cam);
    let kept = 0;
    for (let d = 0; d < 400; d++) {
      renderer.update([car(1, d, 0)]);
      if (drawnCount(scene) === 0) break;
      kept = d;
    }

    expect(edge, '這個視野下沿 +x 一台都看不到，測試本身有問題').toBeGreaterThan(0);
    expect(kept, '剛好切在畫面邊界上 —— 邊緣的車會突然消失').toBeGreaterThan(edge);
  });

  it('should light only the vehicles it draws', () => {
    // Counting the lights over **all** vehicles wastes the culling: there are then more lights than
    // vehicles, and the extras draw off screen.
    const { scene, renderer } = setup();
    renderer.setCullCamera(isoCamera({ x: 0, z: 0 }, 40));
    const near = block(1, 0, 0, 6);
    const far = block(1000, 500, 500, 12);
    renderer.update([...near, ...far]);

    for (const mesh of lightMeshes(scene)) {
      expect(effective(mesh), '燈的數量沒有跟著剔除走').toBe(near.length);
    }
  });
});

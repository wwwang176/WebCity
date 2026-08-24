import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleRenderer, type VehicleData } from '../VehicleRenderer';
import { SIMULATION } from '../../core/simulation/SimulationConstants';

/**
 * Every vehicle handed to `update()` is drawn.
 *
 * At a rendering capacity of 500 per vehicle type against a simulation limit of
 * `VEHICLE_CAP_MAX` (2000) **across all types**, and with 80% of commuters classified as `car`,
 * cars pass 500 at a population of about 2400. Those past it still take part in collisions —
 * `advanceEdgeVehicles` runs over `traffic.vehicles` and is unrelated to rendering — and simply are
 * not drawn.
 *
 * On screen: a vehicle brakes for a large empty gap ahead, and a second or two later the invisible
 * one appears out of nothing. `vehicles` is compacted in place and its order is spawn order, so a
 * freshly spawned vehicle sits at the array's end and is only drawn once enough ahead of it have
 * left and its index falls below 500.
 *
 * Pedestrians do not have this problem: `PedestrianRenderer`'s `maxCount` is
 * `PEDESTRIAN.MAX_ACTIVE`, and the two agree.
 */

function cars(n: number): VehicleData[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x: i * 0.5,
    y: 0,
    heading: 0,
    type: 'car' as const,
    laneOffset: 0,
  }));
}

/** The body layers: vehicle material, casting shadows. Headlights and tail lights are `MeshBasicMaterial` and cast none. */
function bodyMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.castShadow,
  );
}

/** The two light layers: additive, casting no shadows, and held above the bodies by `renderOrder`. */
function lightMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.renderOrder === 10,
  );
}

/**
 * How many instances this mesh can actually draw.
 *
 * Not `mesh.count`: that value is written unconditionally, even past what `instanceMatrix` holds.
 * `setMatrixAt` cannot write beyond it — a typed array discards out-of-range indices silently — and
 * what draws is an empty matrix. Reading `count` lets a capacity error through.
 */
function effective(mesh: THREE.InstancedMesh): number {
  return Math.min(mesh.count, mesh.instanceMatrix.count);
}

function drawnCount(scene: THREE.Scene): number {
  return bodyMeshes(scene).reduce((n, m) => n + effective(m), 0);
}

/** Whether any instance in the scene is drawn at this x. */
function drawnAt(scene: THREE.Scene, x: number): boolean {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const mesh of bodyMeshes(scene)) {
    for (let i = 0; i < effective(mesh); i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.x - x) < 1e-6) return true;
    }
  }
  return false;
}

describe('車輛的實例容量', () => {
  it('should draw every car handed to it, past the old 500 cap', () => {
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    expect(drawnCount(scene), '有車被靜靜地丟掉了').toBe(list.length);
  });

  it('should draw the newest car, not just the first 500', () => {
    // What is dropped is the array's **end**, the most recently spawned ones. A total alone suggests
    // a few unimportant vehicles are missing, when what is missing is exactly the one that has just
    // taken to the road.
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    expect(drawnAt(scene, list[699]!.x), '最後生成的那台車沒有被畫出來').toBe(true);
  });

  it('should hold every vehicle the simulation can put on the road', () => {
    // The simulation's limit is across all types and the mix is decided entirely by the city: in the
    // extreme, all 2000 can be one type. A rendering capacity hard-coded below it is one some city
    // will reach.
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(SIMULATION.VEHICLE_CAP_MAX);
    renderer.update(list);

    expect(drawnCount(scene), '撞到模擬端的車輛上限就開始漏車').toBe(list.length);
  });

  it('should light every car it draws', () => {
    // Headlights and tail lights share one mesh whose capacity is computed separately from the
    // bodies': grown for the bodies but not the lights, a whole batch of vehicles has no headlights
    // at night, and by day nothing shows, since the lights' opacity is 0.
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const list = cars(700);
    renderer.update(list);

    for (const mesh of lightMeshes(scene)) {
      expect(effective(mesh), '有車沒有燈').toBe(list.length);
    }
  });

  it('should grow the airplane tail and nav lights with the fleet', () => {
    // The tail and the navigation lights are two more meshes, each copying its matrix from the
    // fuselage per aircraft. Grown for the fuselage but not for them, the extra aircraft have no
    // vertical tail.
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    const planes: VehicleData[] = Array.from({ length: 700 }, (_, i) => ({
      id: i + 1, x: i * 0.5, y: 0, heading: 0,
      type: 'airplane' as const, laneOffset: 0, altitude: 2,
    }));
    renderer.update(planes);

    // Fuselage and tail both cast shadows, so the two layers together are twice the count.
    expect(drawnCount(scene), '飛機的尾翼沒有跟著長').toBe(planes.length * 2);
  });

  it('should keep drawing everything after the count falls back', () => {
    // Growing the capacity must not break later frames: count shrinks back with it, no remnant of
    // the previous frame stays, and a larger capacity does not draw vehicles that do not exist.
    const scene = new THREE.Scene();
    const renderer = new VehicleRenderer();
    renderer.build(scene);

    renderer.update(cars(700));
    renderer.update(cars(12));

    expect(drawnCount(scene), '車少了之後畫出了不存在的車').toBe(12);
    expect(drawnAt(scene, cars(12)[11]!.x), '縮回去之後反而漏畫').toBe(true);
  });
});

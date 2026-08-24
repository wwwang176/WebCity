import * as THREE from 'three';
import { AirplaneAnimator, type AirportSystemLike } from '../renderer/AirplaneAnimator';
import { civicVehicleGeometry } from '../renderer/geometry/civic/assemble';
import { createVehicleMaterial } from '../renderer/vehicleMaterial';
import { getRotatedSize } from '../core/building/InfraConfig';
import { getAirportDimensions, type Airport, type AirportSize }
  from '../core/transport/AirportSystem';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/**
 * The showcase's aircraft arrival and departure animation.
 *
 * Aircraft animation is what makes the comparison possible, and what it is compared against is the
 * **painted markings**: does the aircraft land on the runway, follow the taxiway, park at the gate.
 * Those three are visible only with the aircraft actually moving.
 *
 * It runs the **same** `AirplaneAnimator` the game does rather than a second copy: with a second
 * copy the alignment seen in the showcase and the alignment in game are two different things, and
 * the showcase's only value is that what it shows is what ships.
 */

/** One airport's position in the showcase. */
export interface PlaneField {
  size: AirportSize;
  /** The footprint's centre in cells, the same coordinates as `civicLayout`'s slots. */
  x: number;
  z: number;
}

/**
 * How many aircraft may be drawn at once.
 *
 * `AirplaneAnimator`'s `MAX_ACTIVE` is 1 small, 1 medium and 2 large, 4 across the three airports.
 * The pool is 8 so that it never has to be rebuilt mid-flight, which makes the aircraft flicker.
 */
const POOL_SIZE = 8;

export class ShowcasePlanes {
  private readonly animator = new AirplaneAnimator();
  private readonly pool: THREE.Mesh[] = [];
  private readonly out: TransportVehicleRenderData[] = [];
  private readonly system: AirportSystemLike;
  private airports: Airport[] = [];

  constructor(private readonly scene: THREE.Scene) {
    const material = createVehicleMaterial();
    // The fuselage and tail are merged into one: they move together, and separating them only costs
    // a draw call. The geometry is the same as the **aircraft parked on the apron**
    // (`civicVehicleGeometry`), so those in the air and those on the ground share a livery.
    const geo = civicVehicleGeometry('airplane');
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
    this.system = { getAirports: () => this.airports };
  }

  /**
   * Sets which airports run animations this round.
   *
   * `AirplaneAnimator` derives the footprint's centre as `airport.x + (w - 1) / 2`, where `airport.x`
   * is the top-left cell index, so the value is converted back here. Putting a slot's centre straight
   * into `x` offsets every aircraft by half an airport.
   */
  setFields(fields: readonly PlaneField[]): void {
    this.airports = fields.map((f, id): Airport => {
      const dim = getAirportDimensions(f.size);
      const { w, h } = getRotatedSize(dim.w, dim.h, 0);
      return {
        id,
        x: f.x - (w - 1) / 2,
        y: f.z - (h - 1) / 2,
        size: f.size,
        rotation: 0,
        // The showcase has no simulation; these four values only satisfy the type.
        noisePollution: 0, touristsPerTick: 0, cargoPerTick: 0, operatingCost: 0,
      };
    });
  }

  /** Advances one frame. `dt` is in seconds. */
  update(dt: number): void {
    this.out.length = 0;
    this.animator.update(dt, 1, this.system, this.out);

    for (const [i, mesh] of this.pool.entries()) {
      const v = this.out[i];
      if (!v) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(v.x, v.altitude ?? 0.09, v.y);
      // The same order as `VehicleRenderer`: the heading about y first, then roll (about x) and
      // pitch (about z) in **local** space. Reversed, a climbing aircraft flies on its side.
      mesh.rotation.set(0, 0, 0);
      mesh.rotateY(v.heading);
      if (v.roll) mesh.rotateX(v.roll);
      if (v.pitch) mesh.rotateZ(v.pitch);
      const s = v.scale ?? 1;
      mesh.scale.set(s, s, s);
    }
  }

  /** Clears the aircraft from the scene, on a change of view mode. */
  clear(): void {
    this.airports = [];
    this.out.length = 0;
    for (const mesh of this.pool) mesh.visible = false;
  }

  dispose(): void {
    this.animator.dispose();
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.pool.length = 0;
  }
}

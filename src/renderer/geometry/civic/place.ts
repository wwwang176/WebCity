import * as THREE from 'three';
import { getBuildingMaterial } from '../../BuildingMaterial';
import { createVehicleMaterial } from '../../vehicleMaterial';
import { stampZoneCategory, ZONE_CAT, triangleCount } from '../buildings/parts';
import { GROUND_LAYERS } from '../buildings/propBands';
import {
  assembleCivic, assembleDecals, assembleFixtures, assembleVehicles,
} from './assemble';
import { stampInstanceValues } from './instanceAttrs';
import type { CivicPlan } from './types';

/**
 * Draws one `CivicPlan` into a set of meshes.
 *
 * The game (`BuildingRenderer.buildModel`) and the showcase (`showcase/civic.ts`) share this.
 * With the showcase alone using it, the game takes a completely separate path — hand-written
 * `MeshLambertMaterial` over solid `BoxGeometry`, with no windows and no lit windows at night
 * (BUG-238). Two separate drawing paths leave one building looking different in the two places,
 * and "what the showcase shows is what ships" is the showcase's only value.
 */

/** The four layers' triangle counts for one placement. */
export interface CivicTris {
  massing: number;
  decal: number;
  prop: number;
  overhead: number;
}

/**
 * Each layer's placement rules.
 *
 * Shared low props get a mesh of their own but count against the `prop` budget: those primitives
 * are cones, spheres and toruses (indexed, with uvs) while masses go through `shapeOf`
 * (non-indexed, no uvs), and `mergeGeometries` cannot combine them, hence two meshes. They are
 * still low props, and there is no reason for a second budget.
 */
const LAYERS: ReadonlyArray<{
  /** Which budget entry this layer's triangles count against. */
  key: keyof CivicTris;
  build: (plan: CivicPlan) => THREE.BufferGeometry;
  castShadow: boolean;
  /** Dropped wholesale at distant LOD. Decals are not: they hold up the sense that the ground has something on it. */
  culled: boolean;
  /** Decal geometry carries absolute heights already; everything else starts from the building's underside. */
  baseY: number;
}> = [
  {
    key: 'decal', castShadow: false, culled: false, baseY: 0,
    build: p => assembleDecals(p.decals, p.footprint),
  },
  {
    key: 'massing', castShadow: true, culled: false, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.massing, p.footprint, p.color),
  },
  {
    key: 'prop', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.props, p.footprint, p.color),
  },
  {
    key: 'prop', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleFixtures(p.fixtures, p.footprint),
  },
  {
    key: 'overhead', castShadow: true, culled: true, baseY: GROUND_LAYERS.BUILDING,
    build: p => assembleCivic(p.overhead, p.footprint, p.color),
  },
];

/**
 * The material parked vehicles use.
 *
 * It lives in `renderer/vehicleMaterial`, the same factory `VehicleRenderer` uses: written
 * twice, a change to the vehicle material would leave the ones in car parks silently on the old
 * one.
 */
let vehicleMaterial: THREE.MeshLambertMaterial | null = null;

export interface PlacedCivic {
  /**
   * The layers that use the building shader: decals, masses, low props, overhangs.
   *
   * Separated from `vehicles` **at the type level**, not out of taxonomic tidiness: every mesh
   * here is fed to `stampZoneCategory` and `stampInstanceValues`, and vehicles **must never** be
   * — those two overwrite the real RGB in `color`. In one array, someone eventually writes
   * `for (const m of meshes)` and turns a patrol car into a grey block.
   */
  building: THREE.Mesh[];
  /** Parked vehicles, using the vehicle material. `null` when there are none. */
  vehicles: THREE.Mesh | null;
  /** The meshes dropped at distant LOD. */
  culled: THREE.Mesh[];
  tris: CivicTris;
}

/** Every mesh in the placement, for a caller that has to dispose of all of them at once. */
export function allMeshes(p: PlacedCivic): THREE.Mesh[] {
  return p.vehicles ? [...p.building, p.vehicles] : [...p.building];
}

export interface PlaceOptions {
  /**
   * 0..1, whether this building is operating. It feeds `aOccupancy`, which the shader reads as
   * `powered`: at 0, not one window lights at night.
   */
  occupancy?: number;
  /** This building's footprint centre in world cells. Drawn into a group, leave it at 0 and let the group translate. */
  slot?: { x: number; z: number };
}

/**
 * Places one civic building into `container`.
 *
 * `container` takes a `THREE.Object3D` rather than a `Scene`: in the game each building is a
 * `Group` carrying a position and a rotation, while the showcase adds them straight to the
 * scene.
 *
 * **Every layer is fed** to `stampInstanceValues`: feeding the massing layer alone leaves the
 * lamps among the low props permanently dark, which is the shape of BUG-230c.
 *
 * A plan's coordinates are always relative to its own centre, so `slot` translates the whole
 * building — **every layer of it**. Vehicles are the easiest to miss, since they do not go
 * through that loop, and the layer left at the origin reads as one building's vehicles parked on
 * somebody else's plot.
 */
export function placeCivicPlan(
  plan: CivicPlan, container: THREE.Object3D, opts: PlaceOptions = {},
): PlacedCivic {
  const material = getBuildingMaterial();
  const occupancy = opts.occupancy ?? 1;
  const slot = opts.slot ?? { x: 0, z: 0 };
  const out: PlacedCivic = {
    building: [], vehicles: null, culled: [],
    tris: { massing: 0, decal: 0, prop: 0, overhead: 0 },
  };

  for (const layer of LAYERS) {
    const geo = layer.build(plan);
    if (geo.getAttribute('position').count === 0) {
      geo.dispose();
      continue;
    }
    stampZoneCategory(geo, ZONE_CAT[plan.facade] ?? 0);
    stampInstanceValues(geo, { occupancy, seed: plan.seed });

    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = layer.castShadow;
    mesh.receiveShadow = true;
    mesh.position.set(slot.x, layer.baseY, slot.z);
    container.add(mesh);

    out.building.push(mesh);
    if (layer.culled) out.culled.push(mesh);
    // `+=` rather than `=`: shared and custom low props share the `prop` entry.
    out.tris[layer.key] += triangleCount(geo);
  }

  // Parked vehicles. **Not through the loop above**: they use the vehicle material and must not
  // be touched by `stampZoneCategory` or `stampInstanceValues`, which overwrite the real RGB in
  // `color` and turn a white-and-blue patrol car into a grey block.
  const vehicleGeo = assembleVehicles(plan.vehicles, plan.footprint);
  if (vehicleGeo.getAttribute('position').count > 0) {
    vehicleMaterial ??= createVehicleMaterial();
    const vmesh = new THREE.Mesh(vehicleGeo, vehicleMaterial);
    vmesh.castShadow = true;
    vmesh.receiveShadow = true;
    vmesh.position.set(slot.x, GROUND_LAYERS.BUILDING, slot.z);
    container.add(vmesh);
    out.vehicles = vmesh;
    // Vehicles drop at distant LOD with the rest: they are at the same scale as low props.
    out.culled.push(vmesh);
  } else {
    vehicleGeo.dispose();
  }

  return out;
}

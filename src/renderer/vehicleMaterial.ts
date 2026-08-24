import * as THREE from 'three';

/**
 * The vehicle material.
 *
 * A vehicle's colour is written **straight into the `color` attribute** by `setVertexColors` in
 * `geometry/common.ts`, so vehicles take a Lambert with `vertexColors: true` rather than the
 * building shader, which reads `color` as a part label, zone and ground lightness.
 *
 * A factory because both `VehicleRenderer` and the civic buildings' car parks build it: with a
 * `new MeshLambertMaterial({ vertexColors: true })` written on each side, adding `flatShading` to
 * vehicles or switching the material would silently leave the parked ones as they were.
 *
 * It returns a new instance rather than a singleton: `VehicleRenderer` builds one `InstancedMesh`
 * per vehicle type, and those may come to need different settings.
 */
export function createVehicleMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

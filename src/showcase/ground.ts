import * as THREE from 'three';
import { TERRAIN_COLORS } from '../renderer/terrainColors';
import { TerrainType } from '../core/grid/types';

/**
 * The showcase's floor.
 *
 * Its colour and lighting model have to match the game's terrain, because **ground decals are read by
 * contrast**: industrial asphalt is shade 0, a near-black 0.20, giving a lightness ratio of 2.75
 * against the game's bright green terrain and standing out at a glance, but only 1.35 against a dark
 * green `0x3a4a3a` chosen for the showcase, where it nearly merges into the background — making
 * "industrial seems to have no paving" an illusion peculiar to the showcase.
 *
 * The game's terrain is a `MeshLambertMaterial` with a per-cell `DataTexture`. That texture sets no
 * `colorSpace`, so it is linear, and the values written into it are the linear values
 * `THREE.Color.set(hex)` produces — so `color: hex` here gives the same linear colour.
 */
export function createShowcaseGround(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshLambertMaterial({
    color: TERRAIN_COLORS[TerrainType.PLAIN],
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

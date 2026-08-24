import * as THREE from 'three';
import { FLOOR_HEIGHT_UNITS } from '../buildings/massing/metrics';
import { floorHeightOf } from '../buildings/massing';
import type { Density } from '../buildings/registry';

/**
 * Per-instance attributes.
 *
 * Zoned buildings carry these values on an `InstancedBufferAttribute`, one set per building.
 * Civic buildings are drawn as plain `Mesh` objects — each has different geometry and
 * instancing is pointless — so those attributes **do not exist at all**, and WebGL feeds 0 for
 * every unbound attribute. Hence:
 *
 *   - `aSeed.x = 0` -> the facade's storey height is always the minimum and stops lining up with
 *     the mass's actual floor lines
 *   - `aSeed.y = 0` -> every building shares one window phase and a whole street aligns into one
 *     horizontal line
 *   - `aOccupancy = 0` -> the shader reads "nobody here", so **not one window lights**
 *
 * None of the three reports anything; they only leave the building looking slightly wrong. The
 * third is BUG-238's symptom: civic buildings go entirely dark at night.
 *
 * This spreads one set of values across every vertex. A non-instanced `attribute` is per vertex,
 * and one value per geometry means the whole building shares it, matching the game's per-instance
 * semantics.
 */

/** The four per-instance attributes the shader reads, with their component counts. */
const ATTRIBUTES: ReadonlyArray<readonly [string, number]> = [
  ['aHighlight', 1],
  ['aHighlightColor', 3],
  ['aOccupancy', 1],
  ['aSeed', 3],
  ['aBldgColor', 3],
];

export interface InstanceValues {
  /** 0..1, occupancy or utilisation. 0 means nobody, and every window and sign is dark. */
  occupancy: number;
  /** The aSeed handed to the shader: floor rhythm, phase, material preference. */
  seed: readonly [number, number, number];
  /**
   * The walls' base colour (`aBldgColor`). Omitted, it takes neutral grey.
   *
   * Zoned buildings go through `InstancedMesh.setColorAt`, so this value is used only on the
   * civic path.
   */
  color?: readonly [number, number, number];
}

/**
 * `aSeed.x`'s encoding; the shader reads it as `mix(MIN, MAX, aSeed.x)`.
 *
 * The same expression as in `BuildingRenderer.setInstanceData`. Written on both sides, the
 * showcase's window rows drift from the mass's floor lines with nothing reporting it.
 */
export function floorRhythm01(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  const fh = floorHeightOf(zoneType, density, level, variantIndex);
  return (fh - FLOOR_HEIGHT_UNITS.MIN) / (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN);
}

/** Spreads per-instance values into per-vertex attributes and writes them into this geometry. */
const NEUTRAL_GREY = [0.7, 0.7, 0.7] as const;

export function stampInstanceValues(geo: THREE.BufferGeometry, v: InstanceValues): void {
  const count = geo.getAttribute('position').count;
  for (const [name, size] of ATTRIBUTES) {
    // `assembleCivic` has already written aBldgColor **per mass**: a hospital's red cross and a
    // university's gold dome are one mass's colour. Rewriting the whole attribute flattens those
    // overrides, showing up only as "the red cross is gone".
    if (name === 'aBldgColor' && geo.hasAttribute('aBldgColor')) continue;

    const arr = new Float32Array(count * size);
    if (name === 'aOccupancy') arr.fill(v.occupancy);
    if (name === 'aSeed' || name === 'aBldgColor') {
      const src = name === 'aSeed' ? v.seed : (v.color ?? NEUTRAL_GREY);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = src[0]!;
        arr[i * 3 + 1] = src[1]!;
        arr[i * 3 + 2] = src[2]!;
      }
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
}

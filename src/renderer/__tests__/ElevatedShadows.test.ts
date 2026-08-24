import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { Grid } from '../../core/grid/Grid';
import { RoadType, RoadDirection } from '../../core/road/types';

/**
 * An elevated kerb casts no shadow.
 *
 * It is a **zero-thickness** plane, a flattened `PlaneGeometry`, with its normal up. Drawing the
 * shadow map, three.js renders the **back** face of a `FrontSide` material by default
 * (`shadowSideTable`): seen from an overhead sun the plane shows its front face, the back face is
 * culled, the depth map holds nothing and there is no shadow.
 *
 * An elevated road surface is a `BoxGeometry` whose underside is a back face, so it always has a
 * shadow — and side by side, the missing one stands out.
 *
 * These cases do not compare one field against one value; they ask a question that recurs:
 * **anything that claims to cast a shadow without having thickness has to set `shadowSide`**.
 */

function buildElevated(): THREE.Scene {
  const grid = new Grid(8, 8);
  const em = new ElevationManager();
  const seg = {
    roadType: RoadType.TWO_LANE,
    roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
    railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0,
  };
  for (let y = 2; y <= 5; y++) em.set(4, y, 1, seg);

  const scene = new THREE.Scene();
  new ElevatedRoadRenderer().build(scene, grid, em);
  return scene;
}

/** Whether a geometry has thickness: all three axes must extend for it to count as solid. */
function isFlat(geo: THREE.BufferGeometry): boolean {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const eps = 1e-6;
  return (b.max.x - b.min.x) < eps || (b.max.y - b.min.y) < eps || (b.max.z - b.min.z) < eps;
}

describe('高架的影子', () => {
  it('should give every flat caster a shadowSide', () => {
    const casters: THREE.Mesh[] = [];
    buildElevated().traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow) casters.push(o);
    });
    expect(casters.length, '沒有任何東西說要投影，這支測試等於沒測').toBeGreaterThan(0);

    for (const m of casters) {
      if (!isFlat(m.geometry)) continue;
      const mat = m.material as THREE.Material;
      expect(mat.shadowSide, `${m.type} 是零厚度的面，說要投影卻沒有指定 shadowSide`)
        .not.toBeNull();
    }
  });

  it('should actually have a flat caster to worry about', () => {
    // Should the kerb become a box with thickness, the case above would spin idle; this one fails
    // first and points at it.
    const flats = [] as THREE.Mesh[];
    buildElevated().traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow && isFlat(o.geometry)) flats.push(o);
    });
    expect(flats.length).toBeGreaterThan(0);
  });
});

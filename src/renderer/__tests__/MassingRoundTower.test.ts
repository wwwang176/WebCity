import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { volumesFor, isRoundBodied } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { PART_WALL, PART_ROOF } from '../geometry/buildings/parts';
import { buildRoof } from '../geometry/buildings/massing/roofForms';
import { dimensionsFor } from '../geometry/buildings/massing/dimensions';
import type { Volume } from '../geometry/buildings/massing/volume';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { appearanceOf } from '../BuildingAppearance';
import { paletteFor } from '../ColorPalettes';

/**
 * High-density commercial's round tower.
 *
 * Replacing 17 hand-written variants with parameterised generators left `makeComHighV2` — an
 * octagonal shaft plus a disc eave — behind: all eight composers produce rectangular solids. The
 * cylinder returned to `VolumeShape` later for industry's stacks and silos, reachable by industry
 * alone.
 *
 * Whether a round shaft should survive is nowhere in the spec, and none of the acceptance lines —
 * silhouette variety, asymmetric share, triangle budget — turns red for a missing round tower. So
 * the tests stay green and the thing is gone.
 */

const ROUND_ZONE = ZoneType.COMMERCIAL_HIGH;

function roundVariants(level: number): number[] {
  const out: number[] = [];
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    if (isRoundBodied(ROUND_ZONE, 'HIGH', level, vi)) out.push(vi);
  }
  return out;
}

describe('commercial high round tower', () => {
  it('should give at least one variant a round body at the top level', () => {
    expect(roundVariants(3).length, '商業高密度沒有任何圓形變體')
      .toBeGreaterThan(0);
  });

  it('should stay a rarity, not become the whole skyline', () => {
    // A round tower is a landmark. Half of eight being round is no longer distinctive, and it is
    // fully rotationally symmetric: four rotations produce no variation at all on it, so the larger
    // its share the more uniform the district.
    expect(roundVariants(3).length, '圓塔太常見').toBeLessThanOrEqual(2);
  });

  it('should make the round part the building itself, not equipment', () => {
    // Industry's stacks and silos are cylinders too, but they are PART_DETAIL. What separates them
    // is the part tag rather than "is there a cylinder", or an industrial shed counts as a round
    // building.
    const vi = roundVariants(3)[0]!;
    const round = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .filter(v => v.shape === 'cylinder');
    expect(round.some(v => (v.part ?? PART_WALL) === PART_WALL), '圓柱不是牆體')
      .toBe(true);
  });

  it('should not call an industrial chimney a round building', () => {
    // The converse: industry has a stack or a silo at every level while the shed itself is
    // rectangular.
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      expect(isRoundBodied(ZoneType.INDUSTRIAL, 'LOW', 3, vi), `工業變體 ${vi} 被當成圓形建築`)
        .toBe(false);
    }
  });

  it('should keep a circular footprint, not an ellipse', () => {
    // Width and depth are jittered independently, and taking (w, d) directly gives an elliptical
    // cylinder. Being round is the whole point of the shape.
    const vi = roundVariants(3)[0]!;
    const body = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .find(v => v.shape === 'cylinder' && (v.part ?? PART_WALL) === PART_WALL)!;
    expect(body.w, '圓塔被壓成橢圓').toBeCloseTo(body.d, 9);
  });

  it('should cap the round tower with a cornice disc', () => {
    // The earlier makeComHighV2 was a shaft plus a slightly projecting disc, and that disc is why it
    // reads as a building rather than a pipe.
    const vi = roundVariants(3)[0]!;
    const cap = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .filter(v => v.part === PART_ROOF && v.shape === 'cylinder');
    expect(cap.length, '圓塔沒有簷板').toBeGreaterThan(0);

    const body = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .find(v => v.shape === 'cylinder' && (v.part ?? PART_WALL) === PART_WALL)!;
    expect(cap[0]!.w, '簷板沒有外挑').toBeGreaterThan(body.w);
  });

  it('should not put a square parapet or crown on a round top', () => {
    // Tested against `buildRoof` directly rather than through a variant.
    //
    // Written as "sweep the round tower's roof masses and assert each is round", the round tower
    // falls on `roofFor`'s `flat`, which returns an empty array, so the loop checks nothing and the
    // case runs empty and green. Regression checking is what caught it.
    const top: Volume = {
      x: 0, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 1.2, shape: 'cylinder',
    };
    const dims = dimensionsFor(ROUND_ZONE, 'HIGH', 3, 0)!;
    for (const form of ['parapet', 'crown'] as const) {
      const out = buildRoof(form, top, dims, () => 0.5);
      expect(out.length, `${form} 什麼都沒產生，這條測試等於沒測`).toBeGreaterThan(0);
      for (const v of out) {
        expect(v.shape, `${form} 在圓塔上仍然是方的`).toBe('cylinder');
      }
    }
  });

});

describe('round buildings get no overhead props', () => {
  type Internals = { overheadLayer: InstancedLayer; propLayer: InstancedLayer };

  /** Which massing variant this cell falls on, computed the same way BuildingRenderer does. */
  function variantAt(x: number, y: number, level: number): number {
    return appearanceOf({
      x, y, zoneType: ROUND_ZONE, level, seedByte: 0,
      variantCount: VARIANT_COUNT,
      paletteSize: paletteFor(ROUND_ZONE, level).length,
    }).variantIndex;
  }

  function findCell(level: number, wantRound: boolean): [number, number] {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const isRound = isRoundBodied(ROUND_ZONE, 'HIGH', level, variantAt(x, y, level));
        if (isRound === wantRound) return [x, y];
      }
    }
    throw new Error(`找不到 ${wantRound ? '圓形' : '方形'} 的格子`);
  }

  it('should skip the awning and signage layer on a round tower', () => {
    // Canopies and signage are flat panels, and against a curved wall they either pierce it or
    // float — the same class of fault as BUG-226, where a canopy clung to an imagined wall, except
    // that here the wall is curved.
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, true);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.overheadLayer.entryFor(`${x},${y}`), '圓塔還是掛了雨遮／招牌')
      .toBeUndefined();
  });

  it('should still give a square tower its awnings', () => {
    // The converse: this guards against dropping overhangs from the whole zone.
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, false);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.overheadLayer.entryFor(`${x},${y}`), '方形塔樓的懸挑也被關掉了')
      .toBeDefined();
  });

  it('should keep the ground props on a round tower', () => {
    // Only overhangs are dropped. Low props stand on the ground and do not care about wall
    // curvature.
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, true);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.propLayer.entryFor(`${x},${y}`), '圓塔的矮物件也被關掉了')
      .toBeDefined();
  });
});

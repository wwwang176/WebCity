import { describe, it, expect } from 'vitest';
import { roofFormsFor, roofFor, buildRoof } from '../geometry/buildings/massing/roofForms';
import { topOf, maxAbsOf, overlapOf, type Volume }
  from '../geometry/buildings/massing/volume';
import { VARIANT_COUNT, type Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';
import { ZONE_TYPES } from '../geometry/buildings/registry';
import { prototypeFor, prototypesFor } from '../geometry/buildings/massing/prototypes';
import { PART_ROOF } from '../geometry/buildings/parts';

const LEVELS = [1, 2, 3] as const;
const DIMS: Dimensions = { w: 0.7, d: 0.66, floors: 6, floorHeight: 0.26, height: 1.56 };
const TOP: Volume = { x: 0, z: 0, w: 0.7, d: 0.66, y0: 1.3, y1: 1.56 };

describe('roof forms', () => {
  it('should give every zone at least two forms at every level', () => {
    // Roof forms are the cheapest way to double the number of faces without adding prototypes; one
    // form gives none of that.
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        expect(roofFormsFor(z, lv).length, `zone ${z} L${lv}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('should sit on top of the volume it is given', () => {
    // A roof floating above the walls or sunk into the top floor goes unreported.
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          for (const v of buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0))) {
            expect(v.y0, `${form} 沒有貼著頂面`).toBeGreaterThanOrEqual(TOP.y1 - 1e-9);
          }
        }
      }
    }
  });

  it('should never grow beyond the footprint it sits on', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          const vs = buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0));
          if (vs.length === 0) continue;
          expect(maxAbsOf(vs), `${form} 比它站的量體還寬`)
            .toBeLessThanOrEqual(maxAbsOf([TOP]) + 1e-9);
        }
      }
    }
  });

  it('should never overlap its own pieces', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          const vs = buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0));
          for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
              expect(overlapOf(vs[i]!, vs[j]!), `${form} 第 ${i}、${j} 塊重疊`)
                .toBeCloseTo(0, 12);
            }
          }
        }
      }
    }
  });

  it('should tag every roof piece as roof', () => {
    // A roof labelled PART_WALL grows windows.
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          for (const v of buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0))) {
            expect(v.part, `${form} 沒標成屋頂`).toBe(PART_ROOF);
          }
        }
      }
    }
  });

  it('should keep a pitched roof under half a storey tall', () => {
    // Once a roof is taller than half a storey the building's total height is no longer floors
    // times floor height, and the level ladder drifts.
    for (const form of ['gable', 'hip', 'shed', 'sawtooth'] as const) {
      const vs = buildRoof(form, TOP, DIMS, variantRng(1, 'LOW', 1, 0));
      expect(topOf(vs) - TOP.y1, `${form} 太高`)
        .toBeLessThanOrEqual(DIMS.floorHeight * 0.5 + 1e-9);
    }
  });

  it('should use every available form across the eight variants', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const used = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) used.add(roofFor(z, lv, vi));
        expect(used.size, `zone ${z} L${lv}`).toBe(roofFormsFor(z, lv).length);
      }
    }
  });

  it('should not lock a prototype to one roof form', () => {
    // Prototypes cycle by remainder. A roof chosen by remainder too aligns the two periods — an L
    // shape always paired with a gable — and the two dimensions collapse into one. Choosing the roof
    // by band, a slower cycle, enumerates the product.
    //
    // "uses every roof form" does not catch this: a remainder uses them all too, just in fixed
    // pairs.
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const pairs = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          pairs.add(`${prototypeFor(z, lv, vi).name}|${roofFor(z, lv, vi)}`);
        }
        const possible = prototypesFor(z, lv).length * roofFormsFor(z, lv).length;
        expect(pairs.size, `zone ${z} L${lv} 只組出 ${pairs.size} 種配對`)
          .toBe(Math.min(VARIANT_COUNT, possible));
      }
    }
  });

  it('should give a flat roof nothing to build', () => {
    expect(buildRoof('flat', TOP, DIMS, variantRng(1, 'LOW', 1, 0))).toEqual([]);
  });
});

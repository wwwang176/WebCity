import { ZoneType } from '../../../../core/grid/types';
import { PART_ROOF } from '../parts';
import type { Volume } from './volume';
import { VARIANT_COUNT, type Dimensions } from './dimensions';
import { ROOF_PITCH_FRAC } from './metrics';
import type { Rng } from './rng';

/**
 * Roof forms, chosen separately from the prototype: "an L with a gable" and "an L with a flat
 * parapet" are two different variants, and this is the cheapest way to double the number of faces
 * without adding prototypes.
 *
 * Forms only, **no equipment**: water tanks, air handling units and stacks belong to another
 * vocabulary.
 */
export type RoofForm =
  | 'flat' | 'parapet' | 'gable' | 'hip' | 'shed' | 'sawtooth' | 'crown';

const FORMS: Record<number, Array<{ form: RoofForm; minLevel: number }>> = {
  [ZoneType.RESIDENTIAL_LOW]:  [{ form: 'gable', minLevel: 1 }, { form: 'hip', minLevel: 1 }],
  [ZoneType.RESIDENTIAL_HIGH]: [{ form: 'flat', minLevel: 1 }, { form: 'parapet', minLevel: 1 }],
  [ZoneType.COMMERCIAL_LOW]:   [{ form: 'parapet', minLevel: 1 }, { form: 'shed', minLevel: 1 }],
  [ZoneType.COMMERCIAL_HIGH]:  [
    { form: 'parapet', minLevel: 1 }, { form: 'flat', minLevel: 1 },
    { form: 'crown', minLevel: 3 },
  ],
  [ZoneType.INDUSTRIAL]:       [{ form: 'sawtooth', minLevel: 1 }, { form: 'shed', minLevel: 1 }],
  [ZoneType.OFFICE]:           [
    { form: 'parapet', minLevel: 1 }, { form: 'flat', minLevel: 1 },
    { form: 'crown', minLevel: 3 },
  ],
};

export function roofFormsFor(zoneType: number, level: number): RoofForm[] {
  const lv = Math.max(1, Math.min(3, level));
  const list = (FORMS[zoneType] ?? []).filter(f => f.minLevel <= lv).map(f => f.form);
  return list.length > 0 ? list : ['flat', 'parapet'];
}

/**
 * This variant's roof form.
 *
 * It **layers** (`floor(vi * form count / variant count)`) rather than taking a remainder. The
 * prototype uses a remainder, and with both on remainders the periods align and prototype A always
 * pairs with roof X, collapsing two dimensions into one. A fast period against a slow one
 * enumerates the product.
 */
export function roofFor(zoneType: number, level: number, variantIndex: number): RoofForm {
  const forms = roofFormsFor(zoneType, level);
  const i = Math.floor((variantIndex * forms.length) / VARIANT_COUNT);
  return forms[Math.min(i, forms.length - 1)]!;
}

const roof = (v: Omit<Volume, 'part'>): Volume => ({ ...v, part: PART_ROOF });

/**
 * The roof's masses.
 *
 * A pitched roof is always kept within **half a storey**: any higher and a building's total height
 * stops being floor count times storey height, and the level ladder drifts with it.
 */
export function buildRoof(
  form: RoofForm, top: Volume, dims: Dimensions, rng: Rng,
): Volume[] {
  const pitch = dims.floorHeight * ROOF_PITCH_FRAC;
  const base = { x: top.x, z: top.z, y0: top.y1 };

  switch (form) {
    case 'flat':
      return [];

    case 'parapet': {
      // Four rectangular walls cannot enclose a round tower: that is a rectangular frame around a
      // cylinder. A slightly projecting eave replaces them, which is also the disc cap from the
      // earlier makeComHighV2. At 1.06 against the round tower's own 0.92 diameter factor, the
      // outer edge still falls within the footprint's shorter side.
      if (top.shape === 'cylinder') {
        return [roof({
          ...base, w: top.w * 1.06, d: top.d * 1.06,
          y1: top.y1 + dims.floorHeight * 0.12, shape: 'cylinder',
        })];
      }
      // A parapet: a low wall around the top surface. Four pieces rather than a large box minus a
      // small one, since the middle piece would overlap the storey's top face.
      const t = Math.min(top.w, top.d) * 0.06;
      const h = dims.floorHeight * 0.22;
      const innerD = top.d - 2 * t;
      return [
        roof({ ...base, z: top.z - top.d / 2 + t / 2, w: top.w, d: t, y1: top.y1 + h }),
        roof({ ...base, z: top.z + top.d / 2 - t / 2, w: top.w, d: t, y1: top.y1 + h }),
        roof({ ...base, x: top.x - top.w / 2 + t / 2, w: t, d: innerD, y1: top.y1 + h }),
        roof({ ...base, x: top.x + top.w / 2 - t / 2, w: t, d: innerD, y1: top.y1 + h }),
      ];
    }

    case 'crown':
      // A crown: one more narrower section on top. Its shape follows the shaft, since a
      // rectangular block on a round tower wastes the whole cylinder.
      return [roof({
        ...base, w: top.w * 0.62, d: top.d * 0.62,
        y1: top.y1 + dims.floorHeight * 0.5, shape: top.shape,
      })];

    case 'gable':
      return [roof({
        ...base, w: top.w, d: top.d, y1: top.y1 + pitch,
        shape: 'gable', facing: rng() < 0.5 ? 0 : 1,
      })];

    case 'hip':
      return [roof({ ...base, w: top.w, d: top.d, y1: top.y1 + pitch, shape: 'hip' })];

    case 'shed':
      return [roof({
        ...base, w: top.w, d: top.d, y1: top.y1 + pitch,
        shape: 'shed', facing: (Math.floor(rng() * 4) % 4) as 0 | 1 | 2 | 3,
      })];

    case 'sawtooth':
      return [roof({
        ...base, w: top.w, d: top.d, y1: top.y1 + pitch,
        shape: 'sawtooth', facing: rng() < 0.5 ? 0 : 2,
      })];
  }
}

import { ZoneType } from '../../../../core/grid/types';
import { PART_ROOF } from '../parts';
import type { Volume } from './volume';
import { VARIANT_COUNT, type Dimensions } from './dimensions';
import { ROOF_PITCH_FRAC } from './metrics';
import type { Rng } from './rng';

/**
 * 屋頂形式。與原型分開挑 —— 「L 形 + 山牆」與「L 形 + 平頂女兒牆」是兩個不同的
 * 變體，這是在不增加原型數的前提下多一倍面貌最便宜的做法。
 *
 * 這裡只有形式，**沒有設備** —— 水塔、空調、煙囪是 2C-2 的詞彙。
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
 * 這個變體的屋頂形式。
 *
 * 用**分層**（`floor(vi × 形式數 / 變體數)`）而不是餘數：原型用的是餘數，
 * 兩者都用餘數的話週期會對齊，「原型 A 永遠配屋頂 X」—— 兩個維度就只剩一個。
 * 快週期配慢週期才枚舉得到乘積。
 */
export function roofFor(zoneType: number, level: number, variantIndex: number): RoofForm {
  const forms = roofFormsFor(zoneType, level);
  const i = Math.floor((variantIndex * forms.length) / VARIANT_COUNT);
  return forms[Math.min(i, forms.length - 1)]!;
}

const roof = (v: Omit<Volume, 'part'>): Volume => ({ ...v, part: PART_ROOF });

/**
 * 屋頂的量體。
 *
 * 斜屋頂一律壓在**半層樓**以內：高過半層樓的話建築的總高度就不是「樓層數 ×
 * 樓高」了，等級階梯會跟著漂掉。
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
      // 女兒牆：沿著頂面四周一圈矮牆。用四塊而不是「大盒減小盒」——
      // 中間那一塊會與樓層頂面重疊。
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
      // 頂部收分：再收一段細的。
      return [roof({
        ...base, w: top.w * 0.62, d: top.d * 0.62,
        y1: top.y1 + dims.floorHeight * 0.5,
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

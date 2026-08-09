import { describe, it, expect } from 'vitest';
import { getMassingVariants } from '../geometry/buildings/massing';
import { ZONE_TYPES, LEVELS, TARGET_HEIGHTS_M, heightKey, type Density }
  from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';

/**
 * 註冊表本身的性質。幾何的不變式（落地、置中、包絡線、三角形預算、零件標籤）
 * 全部搬到 `MassingGeometry.test.ts` —— 它們是生成器的責任，不是註冊表的。
 */
describe('building variants', () => {
  it('should give every zone at every level a full set of variants', () => {
    for (const zone of ZONE_TYPES) {
      for (const density of ['LOW', 'HIGH'] as Density[]) {
        if (!TARGET_HEIGHTS_M[heightKey(zone, density)]) continue;
        for (const level of LEVELS) {
          expect(getMassingVariants(zone, density, level).length,
            `zone ${zone}/${density} L${level}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should return an empty list for a zone that has no buildings', () => {
    expect(getMassingVariants(ZoneType.NONE, 'LOW', 1)).toEqual([]);
  });

  it('should have no zone with both densities except office', () => {
    // 辦公區是唯一兩種密度都有建築的分區（BUG-220）。多一個就表示高度表被
    // 動過而沒有人重新想過密度的意義。
    const both = ZONE_TYPES.filter(z =>
      TARGET_HEIGHTS_M[heightKey(z, 'LOW')] && TARGET_HEIGHTS_M[heightKey(z, 'HIGH')]);
    expect(both).toEqual([ZoneType.OFFICE]);
  });
});

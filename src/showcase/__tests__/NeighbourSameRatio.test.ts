import { describe, it, expect } from 'vitest';
import { blockCells, matrixCells, neighbourSameRatio, densityFor } from '../views';
import { getMassingVariants } from '../../renderer/geometry/buildings/massing';
import type { Density } from '../../renderer/geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';
import { ZONE_TYPES, LEVELS } from '../../renderer/geometry/buildings/registry';

/**
 * 「看起來很重複」是主觀的，但「隔壁那棟跟我一模一樣」不是。這個比例就是
 * 驗收條件 §7.1 的機器可檢查形式。
 */
describe('neighbourSameRatio', () => {
  it('should report 1 when every cell is identical', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should report 0 when no two neighbours share a variant', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 1, facadeSeed: [0.5, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 2, facadeSeed: [0.7, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 3, facadeSeed: [0.9, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(0);
  });

  it('should count a shared variant as the same even when the facade seed differs', () => {
    // 階段 1 只改立面，剪影不變 —— 這個指標必須看得出剪影還是重複的，
    // 否則階段 2 的成果會被階段 1 的立面變化掩蓋掉。
    const cells = [
      { x: 0, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0.1, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, density: 'LOW' as const, level: 1, variantIndex: 0, facadeSeed: [0.9, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should return 0 for fewer than two cells', () => {
    expect(neighbourSameRatio([])).toBe(0);
  });
});

describe('blockCells', () => {
  it('should fill the requested square', () => {
    expect(blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8)).toHaveLength(64);
  });

  it('should give each cell the appearance its coordinates imply', () => {
    const a = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8);
    const b = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8);
    expect(a).toEqual(b);
  });

  it('should change when the seed byte changes', () => {
    const a = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8, 0);
    const b = blockCells(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 8, 7);
    expect(a).not.toEqual(b);
  });

  it('should keep the street below the repetition threshold', () => {
    // 這一條原本是基準紀錄（「會遠高於 5%」），註解寫著「第二階段完成後改成
    // toBeLessThan(0.05)」。階段 2C-1 就是那一刻：八個生成變體加上鄰居迴避，
    // 實測 3.37%，改造前是 33.4%。
    //
    // 用 24x24 而不是 8x8：小街廓的樣本數只有 112 對，一兩對就會晃動 1%。
    for (const zone of [ZoneType.RESIDENTIAL_LOW, ZoneType.COMMERCIAL_HIGH]) {
      const density = zone === ZoneType.COMMERCIAL_HIGH ? 'HIGH' : 'LOW';
      const ratio = neighbourSameRatio(blockCells(zone, density, 1, 24));
      expect(ratio, `zone ${zone} 相鄰重複 ${(ratio * 100).toFixed(1)}%`).toBeLessThan(0.05);
    }
  });
});

describe('matrixCells', () => {
  it('should include every zone at every level', () => {
    const cells = matrixCells();
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(cells.some(c => c.zoneType === zone && c.level === level),
          `matrix is missing zone ${zone} level ${level}`).toBe(true);
      }
    }
  });
});

describe('densityFor', () => {
  it('should never leave a zone with nothing to draw', () => {
    // BUG-227：展示區切分區時是用**上一個**分區的密度重繪的（syncDensity 掛在
    // 第二個 change 監聽器上，第一個已經先呼叫過 onChange）。住宅高只有 HIGH、
    // 商業低只有 LOW —— 配錯就是零個變體，畫面整片空白。
    //
    // 階段 2C-1 之前 getVariants 根本不看密度，所以這個順序錯誤看不出來。
    for (const zone of ZONE_TYPES) {
      for (const preferred of ['LOW', 'HIGH'] as Density[]) {
        const d = densityFor(zone, preferred);
        for (const level of LEVELS) {
          expect(getMassingVariants(zone, d, level).length,
            `zone ${zone} 偏好 ${preferred} -> ${d} L${level}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should keep the preferred density when the zone has it', () => {
    // 辦公區兩種都有，不該被無故換掉 —— 否則使用者選了高密度卻看到低密度。
    expect(densityFor(ZoneType.OFFICE, 'LOW')).toBe('LOW');
    expect(densityFor(ZoneType.OFFICE, 'HIGH')).toBe('HIGH');
  });
});
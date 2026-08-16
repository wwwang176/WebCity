import { describe, it, expect } from 'vitest';
import { WALK_DISUTILITY, walkWeightOf } from '../WalkWillingness';
import { EducationLevel } from '../types';

/**
 * 走一分鐘比坐一分鐘難熬。
 *
 * 光比「誰比較快」表達不出這件事：模型裡開車與走路都是一格一單位時間，所以走一格
 * 到站牌跟開車走那一格成本相同，走路完全沒有額外的不情願。真實世界的模式選擇模型
 * 會把步行時間加權 1.5~2 倍，因為走路的代價超過它花掉的時間。
 *
 * 願不願意走是有差別的：受過教育的人更在意健康與環境，也比較不會把「非開車不可」
 * 當成理所當然。這個遊戲裡沒有獨立的收入欄位 —— 收入是由教育程度推導的
 * （`EDUCATION_SALARY_MULTIPLIERS`），所以教育這一個軸同時代表了知識與收入。
 */

describe('步行的不情願權重', () => {
  it('should always make walking feel longer than it takes', () => {
    for (const level of Object.values(EducationLevel)) {
      expect(walkWeightOf(level), `${level} 的步行權重不到 1，走路變成一種享受`)
        .toBeGreaterThan(1);
    }
  });

  it('should make the educated more willing to walk', () => {
    expect(walkWeightOf(EducationLevel.UNIVERSITY))
      .toBeLessThan(walkWeightOf(EducationLevel.HIGH_SCHOOL));
    expect(walkWeightOf(EducationLevel.HIGH_SCHOOL))
      .toBeLessThan(walkWeightOf(EducationLevel.ELEMENTARY));
    expect(walkWeightOf(EducationLevel.ELEMENTARY))
      .toBeLessThan(walkWeightOf(EducationLevel.NONE));
  });

  it('should stay within a believable band', () => {
    // 低於 1 走路變享受，高於 3 等於沒有人肯走到站牌 —— 大眾運輸整個失效。
    for (const level of Object.values(EducationLevel)) {
      expect(walkWeightOf(level)).toBeLessThanOrEqual(3);
    }
  });

  it('should fall back for a citizen with no education recorded', () => {
    // 舊存檔可能沒有這個欄位。
    expect(walkWeightOf(undefined as unknown as EducationLevel))
      .toBe(WALK_DISUTILITY.FALLBACK);
  });
});

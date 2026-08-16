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
  it('should make walking feel longer than it takes for most people', () => {
    // 交通工程的慣例：對一般人來說走路的代價超過它花掉的時間。
    expect(walkWeightOf(EducationLevel.NONE)).toBeGreaterThan(1);
    expect(walkWeightOf(EducationLevel.ELEMENTARY)).toBeGreaterThan(1);
    expect(walkWeightOf(EducationLevel.HIGH_SCHOOL)).toBeGreaterThan(1);
  });

  it('should make a graduate actively prefer walking', () => {
    // 低於 1 是刻意的：受過高等教育的人在意健康與環境，寧可走路，即使慢一點。
    // 整條階梯因此跨過 1.0 ——「勉強忍受」與「主動選擇」是兩種不同的態度，
    // 而玩家蓋大學就是在把市民從前者推向後者。
    expect(
      walkWeightOf(EducationLevel.UNIVERSITY),
      '大學畢業者只是比較能忍，還不到主動選擇走路',
    ).toBeLessThan(1);
  });

  it('should make the educated more willing to walk', () => {
    expect(walkWeightOf(EducationLevel.UNIVERSITY))
      .toBeLessThan(walkWeightOf(EducationLevel.HIGH_SCHOOL));
    expect(walkWeightOf(EducationLevel.HIGH_SCHOOL))
      .toBeLessThan(walkWeightOf(EducationLevel.ELEMENTARY));
    expect(walkWeightOf(EducationLevel.ELEMENTARY))
      .toBeLessThan(walkWeightOf(EducationLevel.NONE));
  });

  it('should stay within a band where the number still does something', () => {
    // 上界 3：再高就沒有人肯走到站牌，大眾運輸整個失效。
    // 下界 0.8：實測 0.8 時不塞車也走滿捷運的 8 格上限，再低下去行為完全一樣 ——
    // 那不是一個更強的設定，只是一個看起來不同的數字。
    for (const level of Object.values(EducationLevel)) {
      expect(walkWeightOf(level), `${level} 的權重超出有意義的範圍`)
        .toBeLessThanOrEqual(3);
      expect(walkWeightOf(level), `${level} 的權重低到再調也沒有差別`)
        .toBeGreaterThanOrEqual(0.8);
    }
  });

  it('should fall back for a citizen with no education recorded', () => {
    // 舊存檔可能沒有這個欄位。
    expect(walkWeightOf(undefined as unknown as EducationLevel))
      .toBe(WALK_DISUTILITY.FALLBACK);
  });
});

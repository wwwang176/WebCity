import { describe, it, expect } from 'vitest';
import { citizenWorkLabel } from '../CitizenPresentation';
import { isWorkingAge, LIFE_STAGE_AGE, MAX_AGE } from '../types';

/**
 * 面板上的「Unemployed」要跟總覽算的是同一件事。
 *
 * 總覽兩頁都只數**工作年齡**的人（`isWorkingAge` / `lifeStage === ADULT`），面板卻
 * 對任何 `workplaceId === null` 的人都印 Unemployed —— 小孩、學生、退休的老人全都
 * 被算成失業。於是一座「Full employment、662 個職缺」的城市，點開住宅一看滿滿的
 * Unemployed。數字沒錯，是那個詞用錯了。
 */

const at = (age: number, over: Partial<{ workplaceId: string | null; educationProgress: number }> = {}) =>
  ({ age, workplaceId: null, educationProgress: 0, ...over });

describe('citizenWorkLabel', () => {
  it('should show where they work when they have a job', () => {
    expect(citizenWorkLabel(at(100, { workplaceId: '12,34' }))).toBe('12,34');
  });

  it('should call a jobless adult unemployed', () => {
    expect(citizenWorkLabel(at(100))).toBe('Unemployed');
  });

  it('should call a pensioner retired, not unemployed', () => {
    expect(citizenWorkLabel(at(LIFE_STAGE_AGE.ADULT_MAX + 1))).toBe('Retired');
    expect(citizenWorkLabel(at(MAX_AGE - 1))).toBe('Retired');
  });

  it('should call an enrolled child a student', () => {
    expect(citizenWorkLabel(at(20, { educationProgress: 5 }))).toBe('Student');
    expect(citizenWorkLabel(at(40, { educationProgress: 1 }))).toBe('Student');
  });

  it('should not call a toddler unemployed either', () => {
    expect(citizenWorkLabel(at(2))).toBe('Too young to work');
    expect(citizenWorkLabel(at(20))).toBe('Too young to work');
  });

  it('should say Unemployed exactly when the overview counts one', () => {
    // 這是整條測試的重點:面板與總覽必須對同一群人說同一件事。總覽數的是
    // `isWorkingAge(age) && workplaceId === null`。
    for (let age = 0; age <= MAX_AGE; age++) {
      const label = citizenWorkLabel(at(age));
      const counted = isWorkingAge(age);
      expect(label === 'Unemployed', `age=${age}`).toBe(counted);
    }
  });

  it('should never say Unemployed about someone who has a job', () => {
    for (let age = 0; age <= MAX_AGE; age += 7) {
      expect(citizenWorkLabel(at(age, { workplaceId: '1,1' }))).toBe('1,1');
    }
  });
});

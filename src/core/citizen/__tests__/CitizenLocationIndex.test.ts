import { describe, it, expect } from 'vitest';
import { buildCitizenLocationIndex } from '../CitizenLocationIndex';
import { EducationLevel } from '../types';

/**
 * 服務負載原本每個都逐市民掃一遍，每位付兩次 `parsePosKey`、兩次 `getCoverage`、
 * 一次 `getCell`。同一棟樓的住戶查出來完全一樣 —— 12 434 人只住在 103 棟樓裡。
 */

function c(homeId: string | null, workplaceId: string | null,
  education = EducationLevel.NONE) {
  return { homeId, workplaceId, education };
}

describe('每一格住了幾個人', () => {
  it('should count everyone living at the same address once each', () => {
    const idx = buildCitizenLocationIndex([
      c('2,2', '9,9'), c('2,2', '9,9'), c('2,2', null), c('3,3', '9,9'),
    ]);
    expect(idx.homeCounts.get('2,2')).toBe(3);
    expect(idx.homeCounts.get('3,3')).toBe(1);
    expect(idx.workCounts.get('9,9')).toBe(3);
  });

  it('should skip the homeless and the jobless separately', () => {
    // 同一位市民可能有家沒工作、或有工作沒家。兩邊各自判斷，一起判斷的話
    // 「沒工作的人」會連帶從住宅人數裡消失。
    const idx = buildCitizenLocationIndex([
      c(null, '9,9'), c('2,2', null), c(null, null),
    ]);
    expect(idx.homeCounts.get('2,2')).toBe(1);
    expect(idx.homeCounts.size).toBe(1);
    expect(idx.workCounts.get('9,9')).toBe(1);
    expect(idx.workCounts.size).toBe(1);
  });

  it('should break each address down by education', () => {
    // 警局的需求權重看學歷（無學歷 2.0、大學 0.3）。只記總人數的話，
    // 一棟樓裡混住的人會被當成同一種。
    const idx = buildCitizenLocationIndex([
      c('2,2', null, EducationLevel.NONE),
      c('2,2', null, EducationLevel.NONE),
      c('2,2', null, EducationLevel.UNIVERSITY),
    ]);
    const byEdu = idx.homeEducation.get('2,2')!;
    expect(byEdu.get(EducationLevel.NONE)).toBe(2);
    expect(byEdu.get(EducationLevel.UNIVERSITY)).toBe(1);
    expect(byEdu.get(EducationLevel.HIGH_SCHOOL)).toBeUndefined();
  });

  it('should keep the education breakdown consistent with the plain count', () => {
    // 兩份資料算出來的人數不一樣的話，醫院跟警局會對同一棟樓有不同的看法。
    const citizens = [];
    const levels = [EducationLevel.NONE, EducationLevel.ELEMENTARY,
      EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY];
    for (let i = 0; i < 200; i++) {
      citizens.push(c(`${i % 7},4`, null, levels[i % 4]!));
    }
    const idx = buildCitizenLocationIndex(citizens);
    for (const [home, total] of idx.homeCounts) {
      let sum = 0;
      for (const n of idx.homeEducation.get(home)!.values()) sum += n;
      expect(sum, `${home} 的學歷分佈加起來是 ${sum}，總人數是 ${total}`).toBe(total);
    }
  });

  it('should give empty maps for an empty city', () => {
    const idx = buildCitizenLocationIndex([]);
    expect(idx.homeCounts.size).toBe(0);
    expect(idx.homeEducation.size).toBe(0);
    expect(idx.workCounts.size).toBe(0);
  });

  it('should collapse a crowded city to one entry per address', () => {
    // 這是整件事的重點:成本從跟人口成正比變成跟建築成正比。
    const citizens = [];
    for (let i = 0; i < 12_000; i++) citizens.push(c(`${i % 103},4`, `${i % 40},9`));
    const idx = buildCitizenLocationIndex(citizens);
    expect(idx.homeCounts.size, '住址沒有收斂').toBe(103);
    expect(idx.workCounts.size, '工作地沒有收斂').toBe(40);
  });
});

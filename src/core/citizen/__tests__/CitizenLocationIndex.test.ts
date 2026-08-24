import { describe, it, expect } from 'vitest';
import { buildCitizenLocationIndex } from '../CitizenLocationIndex';
import { EducationLevel } from '../types';

/**
 * Each service's load scanned the citizen list itself, paying two `parsePosKey` calls, two
 * `getCoverage` calls and one `getCell` per citizen. Residents of one building produce identical
 * lookups: 12,434 people measured living in 103 buildings.
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
    // One citizen can have a home and no job or a job and no home. Each is decided separately;
    // decided together, people without a job would disappear from the housing counts too.
    const idx = buildCitizenLocationIndex([
      c(null, '9,9'), c('2,2', null), c(null, null),
    ]);
    expect(idx.homeCounts.get('2,2')).toBe(1);
    expect(idx.homeCounts.size).toBe(1);
    expect(idx.workCounts.get('9,9')).toBe(1);
    expect(idx.workCounts.size).toBe(1);
  });

  it('should break each address down by education', () => {
    // Police demand weights follow education, 2.0 for none and 0.3 for university. Recording only
    // a headcount treats a building's mixed residents as one kind.
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
    // With the two records disagreeing on a count, hospitals and police hold different views of
    // one building.
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
    // The point of all of it: the cost goes from proportional to population to proportional to
    // buildings.
    const citizens = [];
    for (let i = 0; i < 12_000; i++) citizens.push(c(`${i % 103},4`, `${i % 40},9`));
    const idx = buildCitizenLocationIndex(citizens);
    expect(idx.homeCounts.size, '住址沒有收斂').toBe(103);
    expect(idx.workCounts.size, '工作地沒有收斂').toBe(40);
  });
});

import { describe, it, expect } from 'vitest';
import { calculatePoliceLoads, calculateFireLoads } from '../PoliceFireLoadCalculator';
import { buildCitizenLocationIndex } from '../../citizen/CitizenLocationIndex';
import { EducationLevel } from '../../citizen/types';
import { ZoneType } from '../../grid/types';
import { HealthService } from '../HealthService';
import { SchoolService } from '../SchoolService';
import { EducationService } from '../EducationService';
import { createGameState } from '../../simulation/GameState';
import { RoadType } from '../../road/types';

/**
 * One road across the map.
 *
 * Load follows **coverage** (BUG-363), so there has to be a road and coverage has to have been
 * computed: with no coverage nobody serves that cell and the demand should land on no facility.
 */
function roadTown(width = 12) {
  const state = createGameState(width, 10);
  for (let x = 0; x < width; x++) {
    state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
  }
  return state;
}

/**
 * Service load counts people per cell before looking anything up. What is pinned is that **this
 * is not an approximation**: downstream only sums entries for one cell, so pre-summing must give
 * every facility exactly the same number.
 *
 * Measured at 120,000 people before the change: `updatePoliceFireLoads` 102ms,
 * `updateHospitalLoads` 33ms, `updateSchoolLoads` 21ms — all of it two `parsePosKey` and two
 * `getCoverage` calls per citizen across a few thousand distinct positions (12,434 people living
 * in 103 buildings).
 */

const BASE_DEMAND = 0.3;
const POLICE_EDUCATION_MULT: Record<string, number> = {
  [EducationLevel.NONE]: 2.0,
  [EducationLevel.ELEMENTARY]: 1.1,
  [EducationLevel.HIGH_SCHOOL]: 0.6,
  [EducationLevel.UNIVERSITY]: 0.3,
};
const POLICE_ZONE_MULT: Partial<Record<ZoneType, number>> = {
  [ZoneType.INDUSTRIAL]: 1.5,
  [ZoneType.COMMERCIAL_LOW]: 1.0,
  [ZoneType.COMMERCIAL_HIGH]: 1.0,
  [ZoneType.OFFICE]: 0.5,
};

interface Person {
  homeId: string | null;
  workplaceId: string | null;
  education: EducationLevel;
}

/** A few buildings packed with people plus a few workplaces, deliberately mixing education levels
 *  within one building. */
function crowdedCity(residents = 900): Person[] {
  const levels = [EducationLevel.NONE, EducationLevel.ELEMENTARY,
    EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY];
  const people: Person[] = [];
  for (let i = 0; i < residents; i++) {
    people.push({
      homeId: `${i % 9},3`,
      workplaceId: i % 5 === 0 ? null : `${i % 4},7`,
      education: levels[(i * 7) % 4]!,
    });
  }
  // One with a job and no home and one with a home and no job: the two are decided separately.
  people.push({ homeId: null, workplaceId: '1,7', education: EducationLevel.NONE });
  people.push({ homeId: '2,3', workplaceId: null, education: EducationLevel.UNIVERSITY });
  return people;
}

const coverAll = { getCoverage: () => true };
const zonedGrid = {
  getCell: (x: number, y: number) => y === 7
    ? { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 }
    : { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 },
};

/** Folds a set of demand entries into the total weight per cell, which is what downstream sees. */
function byPosition(demands: ReadonlyArray<{ x: number; y: number; weight: number }>) {
  const out = new Map<string, number>();
  for (const d of demands) out.set(`${d.x},${d.y}`, (out.get(`${d.x},${d.y}`) ?? 0) + d.weight);
  return out;
}

/** The pre-change form, one entry per citizen. This is the baseline. */
function policeLoadsPerCitizen(people: readonly Person[]) {
  const demands: { x: number; y: number; weight: number }[] = [];
  for (const c of people) {
    if (c.homeId) {
      const [x, y] = c.homeId.split(',').map(Number) as [number, number];
      demands.push({ x, y, weight: BASE_DEMAND * (POLICE_EDUCATION_MULT[c.education] ?? 1) });
    }
    if (c.workplaceId) {
      const [x, y] = c.workplaceId.split(',').map(Number) as [number, number];
      const zt = zonedGrid.getCell(x, y).zoneType as ZoneType;
      demands.push({ x, y, weight: BASE_DEMAND * (POLICE_ZONE_MULT[zt] ?? 1) });
    }
  }
  return demands;
}

describe('去重之後每一格的總量沒有變', () => {
  it('should give police the same per-cell weight as the per-citizen version', () => {
    const people = crowdedCity();
    const now = byPosition(calculatePoliceLoads(
      buildCitizenLocationIndex(people), coverAll, zonedGrid));
    const before = byPosition(policeLoadsPerCitizen(people));

    expect([...now.keys()].sort(), '涵蓋的格子變了').toEqual([...before.keys()].sort());
    for (const [pos, weight] of before) {
      expect(now.get(pos)!, `${pos} 的總權重從 ${weight} 變成 ${now.get(pos)}`)
        .toBeCloseTo(weight, 6);
    }
  });

  it('should collapse a crowded city to one entry per cell', () => {
    // The saving itself. Without the collapse, downstream rescans every facility for each entry.
    const people = crowdedCity();
    const demands = calculatePoliceLoads(
      buildCitizenLocationIndex(people), coverAll, zonedGrid);
    const cells = new Set(demands.map(d => `${d.x},${d.y}`));
    // `cells` is built from the output itself, so "entries === cells" also holds for an empty
    // output. Pinning that the output really covers the expected cells first keeps this from
    // being vacuous.
    expect(cells.size, '一筆條目都沒有 —— 底下兩條會恆真').toBe(9 + 4);
    expect(demands.length, `${people.length} 人生出 ${demands.length} 筆條目`)
      .toBe(cells.size);
    expect(demands.length).toBeLessThan(people.length / 20);
  });

  it('should weight fire demand by headcount, not by address alone', () => {
    // Collapsing to one entry without multiplying by the headcount makes a building of 120 people
    // weigh the same as one with 1.
    const one = calculateFireLoads(buildCitizenLocationIndex(
      [{ homeId: '3,3', workplaceId: null, education: EducationLevel.NONE }]),
    coverAll, zonedGrid, () => 4);
    const four = calculateFireLoads(buildCitizenLocationIndex(
      Array.from({ length: 4 }, () => (
        { homeId: '3,3', workplaceId: null, education: EducationLevel.NONE }))),
    coverAll, zonedGrid, () => 4);

    expect(one.length).toBe(1);
    expect(four.length).toBe(1);
    // One person: 0.3 x (1 + 1/4) = 0.375. Four: 0.3 x (1 + 4/4) x 4 = 2.4.
    expect(one[0]!.weight).toBeCloseTo(0.375);
    expect(four[0]!.weight).toBeCloseTo(2.4);
  });

  it('should weight police demand by the education mix inside one building', () => {
    // Mixed education levels in one building. Recording only a headcount treats them all alike.
    const mixed = calculatePoliceLoads(buildCitizenLocationIndex([
      { homeId: '3,3', workplaceId: null, education: EducationLevel.NONE },
      { homeId: '3,3', workplaceId: null, education: EducationLevel.UNIVERSITY },
    ]), coverAll, zonedGrid);
    // 0.3 × (2.0 + 0.3) = 0.69
    expect(mixed.length).toBe(1);
    expect(mixed[0]!.weight).toBeCloseTo(0.69);
  });

  it('should still skip cells outside coverage', () => {
    const none = calculatePoliceLoads(buildCitizenLocationIndex(crowdedCity()),
      { getCoverage: () => false }, zonedGrid);
    expect(none).toEqual([]);
  });
});

describe('人數有真的傳到服務裡', () => {
  it('should scale hospital demand by the count on each entry', () => {
    // `count` is optional, so omitting it silently falls back to one person per cell: city-wide
    // demand drops by a couple of orders of magnitude with no type error.
    const one = new HealthService();
    one.addHospital(0, 0);
    one.updateLoads([{ x: 3, y: 3, pollution: 0, count: 1 }]);
    const single = one.getLoadRatio();

    const many = new HealthService();
    many.addHospital(0, 0);
    many.updateLoads([{ x: 3, y: 3, pollution: 0, count: 120 }]);

    expect(many.getLoadRatio(), '120 個人的負載跟 1 個人一樣')
      .toBeCloseTo(single * 120, 6);
  });

  it('should scale school enrolment by the count on each entry', () => {
    const state = roadTown();
    const s = new SchoolService('elementary');
    const id = s.addSchool(1, 3);
    s.recalculateCoverage(state.grid);
    s.updateLoads([{ x: 2, y: 4, count: 37 }], []);
    expect(s.getEnrollment(id), '入學人數沒有乘上 count').toBe(37);
    expect(s.getDemand(id)).toBe(37);
  });

  it('should carry the count through EducationService to the right school type', () => {
    // End to end: SimulationLoop sends EnrolledCitizen with a schoolKey and EducationService
    // merely forwards by school stage. Dropping count during that forwarding is invisible to the
    // SchoolService-only test.
    const state = roadTown();
    const edu = new EducationService();
    const elementaryId = edu.addSchool(1, 3, 'elementary');
    edu.recalculateCoverage(state.grid);
    edu.updateSchoolLoads(
      [{ x: 2, y: 4, schoolKey: 'elementary', count: 41 }],
      [{ x: 3, y: 4, schoolKey: 'elementary', count: 9 }],
    );
    expect(edu.getSchoolEnrollment(elementaryId), '在學人數沒有一路傳到學校').toBe(41);
    expect(edu.getSchoolDemand(elementaryId), '候補人數沒有一路傳到學校').toBe(50);
  });

  it('should treat a missing count as one', () => {
    // Existing callers and tests pass no count. Changing the default would silently zero them
    // all.
    const state = roadTown();
    const s = new SchoolService('elementary');
    const id = s.addSchool(1, 3);
    s.recalculateCoverage(state.grid);
    s.updateLoads([{ x: 2, y: 4 }, { x: 2, y: 4 }], []);
    expect(s.getEnrollment(id)).toBe(2);
  });
});

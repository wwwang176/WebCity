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
 * 一條橫貫的路。
 *
 * 負載跟著**覆蓋**走（BUG-363），所以要有路、也要先算過覆蓋 —— 沒有覆蓋就沒有人
 * 在服務那一格，需求不該落到任何一座設施頭上。
 */
function roadTown(width = 12) {
  const state = createGameState(width, 10);
  for (let x = 0; x < width; x++) {
    state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
  }
  return state;
}

/**
 * 服務負載改成「先數成每一格幾個人，再去查」。要釘的是**這不是近似**:
 * 下游對同一格的條目只做加總，先加起來再送進去，每一座設施拿到的數字要一模一樣。
 *
 * 12 萬人實測改動前 `updatePoliceFireLoads` 102ms、`updateHospitalLoads` 33ms、
 * `updateSchoolLoads` 21ms —— 全部是逐市民付兩次 `parsePosKey` 加兩次 `getCoverage`，
 * 而不重複的位置只有幾千個（12 434 人住在 103 棟樓裡）。
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

/** 幾棟樓塞滿人，外加幾個工作地。刻意讓同一棟樓混住不同學歷。 */
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
  // 有工作沒家、有家沒工作的都要有 —— 兩邊各自判斷。
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

/** 把一組需求條目摺成「每一格的總權重」。下游看到的就是這個。 */
function byPosition(demands: ReadonlyArray<{ x: number; y: number; weight: number }>) {
  const out = new Map<string, number>();
  for (const d of demands) out.set(`${d.x},${d.y}`, (out.get(`${d.x},${d.y}`) ?? 0) + d.weight);
  return out;
}

/** 改動前的寫法:逐市民各出一筆。這是比對的基準。 */
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
    // 這是省下來的東西本身。合不起來的話下游每一筆都要再掃一遍所有設施。
    const people = crowdedCity();
    const demands = calculatePoliceLoads(
      buildCitizenLocationIndex(people), coverAll, zonedGrid);
    const cells = new Set(demands.map(d => `${d.x},${d.y}`));
    // `cells` 是從輸出本身建的，所以「筆數 === 格數」在輸出是空陣列時也成立。
    // 先釘住輸出真的涵蓋了該有的格子，這條才不是恆真的。
    expect(cells.size, '一筆條目都沒有 —— 底下兩條會恆真').toBe(9 + 4);
    expect(demands.length, `${people.length} 人生出 ${demands.length} 筆條目`)
      .toBe(cells.size);
    expect(demands.length).toBeLessThan(people.length / 20);
  });

  it('should weight fire demand by headcount, not by address alone', () => {
    // 只留一筆卻忘了乘人數的話，一棟住了 120 人的樓會跟只住 1 人的一樣重。
    const one = calculateFireLoads(buildCitizenLocationIndex(
      [{ homeId: '3,3', workplaceId: null, education: EducationLevel.NONE }]),
    coverAll, zonedGrid, () => 4);
    const four = calculateFireLoads(buildCitizenLocationIndex(
      Array.from({ length: 4 }, () => (
        { homeId: '3,3', workplaceId: null, education: EducationLevel.NONE }))),
    coverAll, zonedGrid, () => 4);

    expect(one.length).toBe(1);
    expect(four.length).toBe(1);
    // 一位:0.3 × (1 + 1/4) = 0.375。四位:0.3 × (1 + 4/4) × 4 = 2.4。
    expect(one[0]!.weight).toBeCloseTo(0.375);
    expect(four[0]!.weight).toBeCloseTo(2.4);
  });

  it('should weight police demand by the education mix inside one building', () => {
    // 一棟樓裡混住不同學歷。只記總人數的話會全部當成同一種。
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
    // `count` 是選填的，漏傳就靜靜地退回每格一人 —— 全城需求會掉到幾百分之一，
    // 而沒有任何型別錯誤。
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
    // 端到端:SimulationLoop 送的是 EnrolledCitizen（帶 schoolKey），而 EducationService
    // 只是按學制轉送。轉送時把 count 丟掉的話，只測 SchoolService 的那條看不出來。
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
    // 既有的呼叫端（與測試）不帶 count。預設值換掉的話它們會靜靜地全部歸零。
    const state = roadTown();
    const s = new SchoolService('elementary');
    const id = s.addSchool(1, 3);
    s.recalculateCoverage(state.grid);
    s.updateLoads([{ x: 2, y: 4 }, { x: 2, y: 4 }], []);
    expect(s.getEnrollment(id)).toBe(2);
  });
});

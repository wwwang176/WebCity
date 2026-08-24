import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { RoadType } from '../../road/types';
import { serviceSeverity } from '../ServiceSeverity';
import { buildServiceStatus } from '../ServiceStatusView';
import { serviceLoadRatiosAt, garbageLoadRatioAt } from '../ServiceLoadAt';

/**
 * The per-cell "how full is the facility serving me".
 *
 * ## Why these go through a real GameState
 *
 * The chain is long: the flood records an owner, the service layer turns the index back into an
 * id, that facility's load over capacity is taken, and it is combined with distance into a
 * severity. A stub anywhere along it tests an invented rule instead — BUG-360's fixture was
 * wrong in exactly the same way the implementation was.
 *
 * So these build real roads and real hospitals and let the real flood run.
 */

/** One road across the map with two hospitals beside it, far enough apart. */
function cityWithTwoHospitals(): { state: GameState; near: string; far: string } {
  const state = createGameState(40, 8);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
  }
  const near = state.health.addHospital(2, 3);
  const far = state.health.addHospital(30, 3);
  state.health.recalculateCoverage(state.grid);
  return { state, near, far };
}

describe('哪一座設施在服務這一格', () => {
  it('should name the hospital that reaches the cell most cheaply', () => {
    const { state, near, far } = cityWithTwoHospitals();

    expect(state.health.getServingFacilityId(3, 4), '左邊那一格該歸左邊那間').toBe(near);
    expect(state.health.getServingFacilityId(31, 4), '右邊那一格該歸右邊那間').toBe(far);
  });

  it('should say nobody serves a cell outside every hospital range', () => {
    const state = createGameState(40, 8);
    state.grid.setCell(0, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    state.health.recalculateCoverage(state.grid);

    expect(state.health.getServingFacilityId(20, 4)).toBeNull();
  });

  it('should forget a hospital that has been demolished', () => {
    // The owner index is a snapshot of the last recompute. It survives the facility's demolition,
    // and resolving it directly points at a different hospital, which is worse than null.
    const { state, near } = cityWithTwoHospitals();
    state.health.removeHospital(near);

    expect(state.health.getServingFacilityId(3, 4)).toBeNull();
  });
});

describe('那一座設施現在多滿', () => {
  it('should report the load of the hospital that actually serves the cell', () => {
    // Overloaded on the left and empty on the right. A per-cell load has to follow the cell, not
    // give the whole city one average.
    const { state, near, far } = cityWithTwoHospitals();
    const nearCap = state.health.getHospitals().find(h => h.id === near)!.capacity;

    // The block beside the left hospital is packed; pollution 0 means BASE_DEMAND 0.3 per person.
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(nearCap * 2 / 0.3) }]);

    const left = state.health.getLoadRatioAt(3, 4);
    const right = state.health.getLoadRatioAt(31, 4);

    expect(left, '左邊那間該爆了').toBeGreaterThan(1.5);
    expect(right, '右邊那間沒人卻跟著爆').toBe(0);
  });

  it('should say -1 where no hospital reaches', () => {
    // 0 reads as "plenty of room". Unavailable and empty are two different things.
    const state = createGameState(40, 8);
    state.health.recalculateCoverage(state.grid);

    expect(state.health.getLoadRatioAt(20, 4)).toBe(-1);
  });

  it('should call a hospital with no capacity at all overloaded, not empty', () => {
    const state = createGameState(20, 8);
    for (let x = 0; x < 20; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const id = state.health.addHospital(2, 3);
    state.health.getHospitals().find(h => h.id === id)!.capacity = 0;
    state.health.recalculateCoverage(state.grid);
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 100 }]);

    expect(state.health.getLoadRatioAt(3, 4)).toBe(Infinity);
  });
});

describe('圓點的顏色', () => {
  it('should turn a cell next door to a swamped hospital bad', () => {
    // The reported symptom: the hospital is next door and the dot stays green forever.
    const { state, near } = cityWithTwoHospitals();
    const cap = state.health.getHospitals().find(h => h.id === near)!.capacity;
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(cap * 2 / 0.3) }]);

    const st = buildServiceStatus(state, 3, 4);

    expect(st.health.cost, '距離那一半:醫院就在隔壁').toBeLessThan(0.2);
    expect(serviceSeverity(st.health.cost, st.health.load), '爆量的醫院旁邊還是綠的')
      .toBeGreaterThan(0.9);
  });

  it('should leave a cell next to an idle hospital green', () => {
    // The converse must hold too, or "always red" would satisfy the test above.
    const { state } = cityWithTwoHospitals();
    state.health.updateLoads([]);

    const st = buildServiceStatus(state, 3, 4);

    expect(serviceSeverity(st.health.cost, st.health.load)).toBeLessThan(0.2);
  });

  it('should not let a utility pretend it has a healthy load', () => {
    // The power grid has no per-cell notion of load. A 0 would be read as "checked, and fine".
    const { state } = cityWithTwoHospitals();

    expect(buildServiceStatus(state, 3, 4).power.load).toBe(-1);
  });
});


describe('學校的負載看的是想讀的人，不是坐得下的人', () => {
  /** One road with a small primary school and a small high school beside it. */
  function schoolTown() {
    const state = createGameState(20, 8);
    for (let x = 0; x < 20; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const elem = state.education.addSchool(2, 3, 'elementary', undefined, 10);
    const high = state.education.addSchool(4, 3, 'highschool', undefined, 10);
    state.education.recalculateCoverage(state.grid);
    return { state, elem, high };
  }

  it('should count the students who want in, not the ones who got a seat', () => {
    // Enrolment can never exceed capacity, so using it as the load makes a school at eleven times
    // demand look exactly right — the high school on a player's save read 5,872 / 500.
    const { state } = schoolTown();
    // Ten with a seat, ninety queueing.
    state.education.updateSchoolLoads(
      [{ x: 3, y: 4, count: 10, schoolKey: 'elementary' }],
      [{ x: 3, y: 4, count: 90, schoolKey: 'elementary' }],
    );

    expect(state.education.getLoadRatioAt(3, 4), '負載看成在學人數了').toBeGreaterThan(1);
  });

  it('should report the fullest school type, not the emptiest', () => {
    // The primary school is empty and the high school full. Taking the emptiest lets the primary
    // school hide the high school's problem.
    const { state, high } = schoolTown();
    state.education.updateSchoolLoads(
      [],
      [{ x: 4, y: 4, count: 200, schoolKey: 'highSchool' }],
    );

    const worst = state.education.getLoadRatioAt(4, 4);

    expect(worst, '取到最空的那一間了').toBeGreaterThan(1);
    expect(state.education.getServingFacilityId(4, 4), '指到的不是最滿的那一間').toBe(high);
  });
});


describe('遠處的學校爆滿，不該讓旁邊這一棟跳警告', () => {
  /**
   * The reported situation: a primary school right beside the housing and not overloaded, while
   * the panel says education is overloaded — because the overloaded school is across town and the
   * warning was fed the city-wide average.
   */
  function twoSchoolTown() {
    const state = createGameState(60, 8);
    for (let x = 0; x < 60; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const near = state.education.addSchool(2, 3, 'elementary', undefined, 400);
    const far = state.education.addSchool(50, 3, 'elementary', undefined, 400);
    state.education.recalculateCoverage(state.grid);
    // 4,000 students beside the far school and only 10 beside the near one.
    state.education.updateSchoolLoads([], [
      { x: 51, y: 4, count: 4000, schoolKey: 'elementary' },
      { x: 3, y: 4, count: 10, schoolKey: 'elementary' },
    ]);
    return { state, near, far };
  }

  it('should keep the demand on the school that actually serves each block', () => {
    const { state, near, far } = twoSchoolTown();

    expect(state.education.getSchoolDemand(near), '近的那間被記上了遠處的學生').toBe(10);
    expect(state.education.getSchoolDemand(far)).toBe(4000);
  });

  it('should leave the block next to the empty school alone', () => {
    // This cell's answer is "the school beside you is empty", not "the city average is
    // overloaded".
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatioAt(3, 4), '旁邊那間很空卻報爆量')
      .toBeCloseTo(10 / 400, 6);
  });

  it('should still shout at the block next to the swamped one', () => {
    // The converse: the far block really is overloaded and the warning has to fire there.
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatioAt(51, 4)).toBeCloseTo(10, 6);
  });

  it('should not be the city-wide average any more', () => {
    // The city-wide ratio is 5.01. Fed to the old warning, every building in the city said
    // "Schools overcrowded", including the ones beside a school standing empty.
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatio(), '全城比值本身沒變（Services 頁還在用）')
      .toBeGreaterThan(4);
    expect(state.education.getLoadRatioAt(3, 4), '逐格的還是跟著全城走')
      .toBeLessThan(1);
  });
});


describe('面板那幾條警告吃的數字', () => {
  /** Two schools: one on the main road and one on a disconnected road that is nearer in a
   *  straight line. */
  function splitTown() {
    const state = createGameState(40, 14);
    for (let x = 0; x < 30; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    for (let y = 8; y < 12; y++) {
      state.grid.setCell(20, y, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    return state;
  }

  it('should send students to the school they can actually get to', () => {
    // School B is five cells away in a straight line, but its road does not connect to the main
    // one and it cannot be reached. Straight-line distance attributed every student to B, and
    // counted unpowered schools too, so B read overloaded while serving nobody (BUG-363).
    const state = splitTown();
    const onRoad = state.education.addSchool(14, 3, 'elementary', undefined, 400);
    const acrossTheGap = state.education.addSchool(20, 9, 'elementary', undefined, 400);
    state.education.recalculateCoverage(state.grid);

    // The students are at (20,4). B is five cells away in a straight line and A a little over
    // six, so straight-line distance picks B — which is unreachable.
    expect(state.education.getCoverage(20, 4, 'elementary'), '這一格不在覆蓋內，測不到東西').toBe(true);
    state.education.updateSchoolLoads([], [
      { x: 20, y: 4, count: 300, schoolKey: 'elementary' },
    ]);

    expect(state.education.getSchoolDemand(onRoad), '學生沒跟著道路走').toBe(300);
    expect(state.education.getSchoolDemand(acrossTheGap), '走不到的學校吸走了學生').toBe(0);
  });

  it('should count the rubbish nobody has picked up yet', () => {
    // The landfill is half full while refuse piles up uncollected in the streets. `currentLoad`
    // alone reports everything as fine, and that refuse is the problem the player sees.
    const state = createGameState(20, 8);
    for (let x = 0; x < 20; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    state.garbage.addFacility(2, 3);
    state.garbage.recalculateCoverage(state.grid);
    const fac = state.garbage.getFacilities()[0]!;
    fac.currentLoad = 0;

    const clean = garbageLoadRatioAt(state, 3, 4);
    state.garbage.reportGarbage(3, 4, fac.capacity * 2);
    const dirty = garbageLoadRatioAt(state, 3, 4);

    expect(clean).toBe(0);
    expect(dirty, '沒人收的垃圾沒算進去').toBeGreaterThan(1);
  });

  it('should hand the panel a per-cell number for every service', () => {
    // All five together, because they are one set of warnings. One left unwired leaves that
    // warning on the city-wide average.
    const { state, near } = cityWithTwoHospitals();
    const cap = state.health.getHospitals().find(h => h.id === near)!.capacity;
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(cap * 2 / 0.3) }]);

    const atNear = serviceLoadRatiosAt(state, 3, 4);
    const atFar = serviceLoadRatiosAt(state, 31, 4);

    expect(atNear.hospitalLoadRatio, '這一頭該爆').toBeGreaterThan(1.5);
    expect(atFar.hospitalLoadRatio, '另一頭跟著爆 = 還是全城平均').toBe(0);
  });

  it('should say -1 where the service does not reach, so no warning fires', () => {
    // The panel tests `> 1`. Uncovered returns -1: a 0 would also not fire the warning, but it
    // means "comfortable", which is not the same as "nobody reaches you".
    const state = createGameState(20, 8);

    const r = serviceLoadRatiosAt(state, 10, 4);

    expect(r.hospitalLoadRatio).toBe(-1);
    expect(r.educationLoadRatio).toBe(-1);
    expect(r.policeLoadRatio).toBe(-1);
    expect(r.fireLoadRatio).toBe(-1);
    expect(r.garbageLoadRatio).toBe(-1);
  });
});


describe('近的滿了，就換下一座', () => {
  /** One road with two small-capacity hospitals on it. */
  function twoSmallHospitals() {
    const state = createGameState(24, 8);
    for (let x = 0; x < 24; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const near = state.health.addHospital(2, 3, 12, 100);
    const far = state.health.addHospital(10, 3, 12, 100);
    state.health.recalculateCoverage(state.grid);
    return { state, near, far };
  }

  it('should list every hospital that can reach the block, nearest first', () => {
    const { state, near, far } = twoSmallHospitals();

    const covering = state.health.getCoveringFacilityIds(3, 4);

    expect(covering.map(c => c.id), '第二間沒被列出來').toEqual([near, far]);
    expect(covering[0]!.cost).toBeLessThan(covering[1]!.cost);
  });

  it('should leave the second hospital empty while the first has room', () => {
    const { state, near, far } = twoSmallHospitals();
    // Demand 30 (0.3 per person, 100 people); the near hospital's capacity of 100 covers it.
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 100 }]);

    expect(state.health.getHospitalLoad(near)).toBe(30);
    expect(state.health.getHospitalLoad(far), '還沒滿就先溢出去了').toBe(0);
  });

  it('should spill into the second hospital once the first is full', () => {
    // As reported: everything crowded into the nearest hospital and the second stayed empty.
    const { state, near, far } = twoSmallHospitals();
    // Demand 150; the near hospital can take only 100.
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    expect(state.health.getHospitalLoad(near), '最近那間該收滿').toBe(100);
    expect(state.health.getHospitalLoad(far), '溢出去的沒有落到第二間').toBe(50);
  });

  it('should call the block well served while the second hospital still has room', () => {
    // The nearest is full but the second is empty, so this block really is served and the dot
    // should not be red.
    const { state } = twoSmallHospitals();
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    const ratio = state.health.getLoadRatioAt(3, 4);

    expect(ratio, '第二間還很空，這一格卻報爆量').toBeLessThan(1);
    expect(serviceSeverity(0, ratio)).toBe(0);
  });

  it('should only go over capacity once every hospital in range is full', () => {
    const { state, near } = twoSmallHospitals();
    // 200 between them against demand of 300.
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 1000 }]);

    expect(state.health.getLoadRatioAt(3, 4), '全滿了還說沒事').toBeGreaterThan(1);
    expect(state.health.getServingFacilityId(3, 4), '全滿時該指回最近的那一間').toBe(near);
  });

  it('should still send nobody to a hospital that cannot reach the block', () => {
    // The hospital across the river: close in a straight line but out of coverage. Spillover must
    // not reach it either.
    const state = createGameState(30, 14);
    for (let x = 0; x < 20; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    for (let y = 8; y < 12; y++) {
      state.grid.setCell(6, y, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const onRoad = state.health.addHospital(2, 3, 12, 100);
    const acrossTheGap = state.health.addHospital(7, 9, 12, 999);
    state.health.recalculateCoverage(state.grid);

    state.health.updateLoads([{ x: 5, y: 4, pollution: 0, count: 2000 }]);

    expect(state.health.getHospitalLoad(acrossTheGap), '走不到的醫院收了病人').toBe(0);
    expect(state.health.getHospitalLoad(onRoad), '全部該壓在走得到的那一間').toBe(600);
  });
});


describe('分母只算收得了人的設施', () => {
  it('should leave a road-less hospital out of the city capacity', () => {
    // A hospital with power but no road connection. It covers nobody, and counting its beds in
    // the denominator dilutes the city-wide load that the death rate is computed from (BUG-100).
    const state = createGameState(24, 12);
    for (let x = 0; x < 24; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const onRoad = state.health.addHospital(2, 3, 12, 100);
    // A hospital in open country, with no road cell anywhere near it.
    state.health.addHospital(15, 10, 12, 900);
    state.health.updateOperationalStatus(() => true);
    state.health.recalculateCoverage(state.grid);

    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    expect(state.health.getHospitalLoad(onRoad), '需求沒有全壓在走得到的那間').toBe(150);
    // The denominator is only the reachable hospital's 100, so 150/100 = 1.5. Including the 900
    // gives 0.15.
    expect(state.health.getLoadRatio(), '用不到的床位被算進分母了').toBeCloseTo(1.5, 6);
  });

  it('should never enrol more students in a school than want to go there', () => {
    // Enrolment and eligibility must be allocated across the same set of schools. Different rules
    // give one school the impossible combination of 200 enrolled and 30 eligible.
    const state = createGameState(24, 8);
    for (let x = 0; x < 24; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    state.education.addSchool(2, 3, 'elementary', undefined, 50);
    state.education.addSchool(10, 3, 'elementary', undefined, 50);
    state.education.recalculateCoverage(state.grid);

    state.education.updateSchoolLoads(
      [{ x: 3, y: 4, count: 80, schoolKey: 'elementary' }],
      [{ x: 3, y: 4, count: 40, schoolKey: 'elementary' }],
    );

    for (const s of state.education.getSchools()) {
      expect(
        state.education.getSchoolEnrollment(s.id),
        `${s.id} 的在學人數比想讀的還多`,
      ).toBeLessThanOrEqual(state.education.getSchoolDemand(s.id));
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { RoadType } from '../../road/types';
import { serviceSeverity } from '../ServiceSeverity';
import { buildServiceStatus } from '../ServiceStatusView';
import { serviceLoadRatiosAt, garbageLoadRatioAt } from '../ServiceLoadAt';

/**
 * 逐格的「服務我的那一座設施現在多滿」。
 *
 * ## 為什麼要走真的 GameState
 *
 * 這條鏈很長:洪水記下擁有者 → 服務層把索引換回 id → 那座設施的負載 ÷ 容量 →
 * 跟距離合成嚴重度。中間任何一段用假物件測，測到的都是我自己編的規則 ——
 * 這個 repo 已經因為那件事吃過好幾次虧（BUG-360 的 fixture 就跟程式碼一起錯）。
 *
 * 所以這裡蓋真的路、真的醫院，讓真的洪水跑過去。
 */

/** 一條橫貫的路，路邊兩座醫院，中間隔得夠遠。 */
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
    // 擁有者索引是上一次重算的快照。設施拆掉之後那個索引還在,直接拿去查會指到
    // 另一間醫院 —— 那比回 null 更糟。
    const { state, near } = cityWithTwoHospitals();
    state.health.removeHospital(near);

    expect(state.health.getServingFacilityId(3, 4)).toBeNull();
  });
});

describe('那一座設施現在多滿', () => {
  it('should report the load of the hospital that actually serves the cell', () => {
    // 左邊塞爆、右邊很空。逐格的負載必須跟著格子走，不是給全城一個平均。
    const { state, near, far } = cityWithTwoHospitals();
    const nearCap = state.health.getHospitals().find(h => h.id === near)!.capacity;

    // 左邊那間旁邊住滿了人（污染 0，所以每人 BASE_DEMAND 0.3）。
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(nearCap * 2 / 0.3) }]);

    const left = state.health.getLoadRatioAt(3, 4);
    const right = state.health.getLoadRatioAt(31, 4);

    expect(left, '左邊那間該爆了').toBeGreaterThan(1.5);
    expect(right, '右邊那間沒人卻跟著爆').toBe(0);
  });

  it('should say -1 where no hospital reaches', () => {
    // 0 會被讀成「很空」。「問不到」跟「很空」是兩件事。
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
    // 這就是使用者問的那一件事:醫院在隔壁，圓點卻永遠是綠的。
    const { state, near } = cityWithTwoHospitals();
    const cap = state.health.getHospitals().find(h => h.id === near)!.capacity;
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(cap * 2 / 0.3) }]);

    const st = buildServiceStatus(state, 3, 4);

    expect(st.health.cost, '距離那一半:醫院就在隔壁').toBeLessThan(0.2);
    expect(serviceSeverity(st.health.cost, st.health.load), '爆量的醫院旁邊還是綠的')
      .toBeGreaterThan(0.9);
  });

  it('should leave a cell next to an idle hospital green', () => {
    // 反面也要成立 —— 不然「永遠是紅的」也會讓上面那條通過。
    const { state } = cityWithTwoHospitals();
    state.health.updateLoads([]);

    const st = buildServiceStatus(state, 3, 4);

    expect(serviceSeverity(st.health.cost, st.health.load)).toBeLessThan(0.2);
  });

  it('should not let a utility pretend it has a healthy load', () => {
    // 電網沒有逐格負載的概念。硬給 0 的話，圓點會把它讀成「查過了，很好」。
    const { state } = cityWithTwoHospitals();

    expect(buildServiceStatus(state, 3, 4).power.load).toBe(-1);
  });
});


describe('學校的負載看的是想讀的人，不是坐得下的人', () => {
  /** 一條路，路邊一間小學、一間高中，容量都很小。 */
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
    // 在學人數頂多等於容量。拿它當負載，一間超收十一倍的學校看起來剛剛好 ——
    // 而那正是玩家存檔裡的高中（5,872 / 500）。
    const { state } = schoolTown();
    // 十個坐得下、九十個排隊。
    state.education.updateSchoolLoads(
      [{ x: 3, y: 4, count: 10, schoolKey: 'elementary' }],
      [{ x: 3, y: 4, count: 90, schoolKey: 'elementary' }],
    );

    expect(state.education.getLoadRatioAt(3, 4), '負載看成在學人數了').toBeGreaterThan(1);
  });

  it('should report the fullest school type, not the emptiest', () => {
    // 小學很空、高中爆滿。取最空的會讓高中的問題被小學蓋掉。
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
   * 使用者回報的情境:住宅旁邊就是國小、那間沒爆量，但面板寫著教育爆量 ——
   * 因為爆的是城市另一頭那間，而警告吃的是全城平均。
   */
  function twoSchoolTown() {
    const state = createGameState(60, 8);
    for (let x = 0; x < 60; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const near = state.education.addSchool(2, 3, 'elementary', undefined, 400);
    const far = state.education.addSchool(50, 3, 'elementary', undefined, 400);
    state.education.recalculateCoverage(state.grid);
    // 遠處那間旁邊擠了 4000 個學生，近的這間旁邊只有 10 個。
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
    // 這一格的答案是「你旁邊那間很空」——不是「全城平均爆了」。
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatioAt(3, 4), '旁邊那間很空卻報爆量')
      .toBeCloseTo(10 / 400, 6);
  });

  it('should still shout at the block next to the swamped one', () => {
    // 反面:遠處那一區確實爆了，警告要照亮。
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatioAt(51, 4)).toBeCloseTo(10, 6);
  });

  it('should not be the city-wide average any more', () => {
    // 全城比值是 5.01 —— 舊的警告吃這個，於是整座城市每一棟都跳「Schools
    // overcrowded」，包括旁邊那間空到不行的。
    const { state } = twoSchoolTown();

    expect(state.education.getLoadRatio(), '全城比值本身沒變（Services 頁還在用）')
      .toBeGreaterThan(4);
    expect(state.education.getLoadRatioAt(3, 4), '逐格的還是跟著全城走')
      .toBeLessThan(1);
  });
});


describe('面板那幾條警告吃的數字', () => {
  /** 兩間學校:一間在主路上，一間在斷開的路上（直線比較近）。 */
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
    // 學校 B 在直線上只有五格遠，但那條路跟主路不相連 —— 走不到。
    // 舊的歐氏規則會把學生全記在 B 頭上（而且連沒電的學校都算），
    // 於是 B 顯示爆滿卻沒服務到人（BUG-363）。
    const state = splitTown();
    const onRoad = state.education.addSchool(14, 3, 'elementary', undefined, 400);
    const acrossTheGap = state.education.addSchool(20, 9, 'elementary', undefined, 400);
    state.education.recalculateCoverage(state.grid);

    // 學生在 (20,4)。B 在直線上只有五格遠、A 有六格多 —— 歐氏規則會挑 B。
    // 但 B 那條路跟主路不相連，走不到。
    expect(state.education.getCoverage(20, 4, 'elementary'), '這一格不在覆蓋內，測不到東西').toBe(true);
    state.education.updateSchoolLoads([], [
      { x: 20, y: 4, count: 300, schoolKey: 'elementary' },
    ]);

    expect(state.education.getSchoolDemand(onRoad), '學生沒跟著道路走').toBe(300);
    expect(state.education.getSchoolDemand(acrossTheGap), '走不到的學校吸走了學生').toBe(0);
  });

  it('should count the rubbish nobody has picked up yet', () => {
    // 掩埋場只有半滿，而街上堆滿沒人收的垃圾 —— 只看 currentLoad 會說一切正常，
    // 但玩家看到的問題就是那些垃圾。
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
    // 五個一起，因為它們是同一組警告。少接一個就是那一條警告停在全城平均。
    const { state, near } = cityWithTwoHospitals();
    const cap = state.health.getHospitals().find(h => h.id === near)!.capacity;
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: Math.ceil(cap * 2 / 0.3) }]);

    const atNear = serviceLoadRatiosAt(state, 3, 4);
    const atFar = serviceLoadRatiosAt(state, 31, 4);

    expect(atNear.hospitalLoadRatio, '這一頭該爆').toBeGreaterThan(1.5);
    expect(atFar.hospitalLoadRatio, '另一頭跟著爆 = 還是全城平均').toBe(0);
  });

  it('should say -1 where the service does not reach, so no warning fires', () => {
    // 面板的判斷是 `> 1`。沒有覆蓋要回 -1 —— 回 0 也不會觸發警告,
    // 但那是「很輕鬆」的意思，跟「沒有人管得到你」是兩件事。
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
  /** 一條路，兩間醫院都在路上，容量都很小。 */
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
    // 需求 30（每人 0.3 → 100 個人），近的那間容量 100，裝得下。
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 100 }]);

    expect(state.health.getHospitalLoad(near)).toBe(30);
    expect(state.health.getHospitalLoad(far), '還沒滿就先溢出去了').toBe(0);
  });

  it('should spill into the second hospital once the first is full', () => {
    // 使用者回報的:上一版全部擠到最近那間，第二間永遠是空的。
    const { state, near, far } = twoSmallHospitals();
    // 需求 150 —— 近的那間只吃得下 100。
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    expect(state.health.getHospitalLoad(near), '最近那間該收滿').toBe(100);
    expect(state.health.getHospitalLoad(far), '溢出去的沒有落到第二間').toBe(50);
  });

  it('should call the block well served while the second hospital still has room', () => {
    // 最近那間滿了，但第二間很空 —— 這一區其實被照顧到了，圓點不該是紅的。
    const { state } = twoSmallHospitals();
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    const ratio = state.health.getLoadRatioAt(3, 4);

    expect(ratio, '第二間還很空，這一格卻報爆量').toBeLessThan(1);
    expect(serviceSeverity(0, ratio)).toBe(0);
  });

  it('should only go over capacity once every hospital in range is full', () => {
    const { state, near } = twoSmallHospitals();
    // 兩間加起來 200，需求 300。
    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 1000 }]);

    expect(state.health.getLoadRatioAt(3, 4), '全滿了還說沒事').toBeGreaterThan(1);
    expect(state.health.getServingFacilityId(3, 4), '全滿時該指回最近的那一間').toBe(near);
  });

  it('should still send nobody to a hospital that cannot reach the block', () => {
    // 河對岸那一間:直線很近，但覆蓋到不了。溢出也不該溢給它。
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
    // 一間有電、但沒接到路的醫院。它涵蓋不到任何人 —— 把它的床位算進分母，
    // 全城負載會被稀釋，而死亡率吃的正是那個比值（BUG-100）。
    const state = createGameState(24, 12);
    for (let x = 0; x < 24; x++) {
      state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b1111 });
    }
    const onRoad = state.health.addHospital(2, 3, 12, 100);
    // 荒地上的醫院:附近一格路都沒有。
    state.health.addHospital(15, 10, 12, 900);
    state.health.updateOperationalStatus(() => true);
    state.health.recalculateCoverage(state.grid);

    state.health.updateLoads([{ x: 3, y: 4, pollution: 0, count: 500 }]);

    expect(state.health.getHospitalLoad(onRoad), '需求沒有全壓在走得到的那間').toBe(150);
    // 分母只算 100（走得到的那間），所以 150/100 = 1.5。摻進 900 的話是 0.15。
    expect(state.health.getLoadRatio(), '用不到的床位被算進分母了').toBeCloseTo(1.5, 6);
  });

  it('should never enrol more students in a school than want to go there', () => {
    // 在學人數與想讀人數必須攤給同一組學校。用不同的規則的話,同一間學校會出現
    // 「在學 200、想讀 30」這種不可能的組合。
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

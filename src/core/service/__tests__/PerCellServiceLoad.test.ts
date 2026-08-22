import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { RoadType } from '../../road/types';
import { serviceSeverity } from '../ServiceSeverity';
import { buildServiceStatus } from '../ServiceStatusView';

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

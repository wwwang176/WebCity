/**
 * 道路成本整數化的特徵測試（characterization test）。
 *
 * 為什麼要整數化：浮點加法**沒有結合律**。反向 Dijkstra（從工作地往外）與
 * 正向 Dijkstra（從家往外）走的是同一組邊、相反的順序，用舊的浮點成本
 * （RURAL = 100/30 = 3.333…）累加出來的總和會差到 1e-15：
 *
 *   10/3 + 10/3 + 10/3 + 2 + 2 === 14
 *   2 + 2 + 10/3 + 10/3 + 10/3 === 14.000000000000002
 *
 * 換成 Float64 也救不了 —— 這與精度無關，是順序問題。整數加法則完全可交換，
 * 所以兩個方向可以用 `.toBe` 逐位元比對。
 *
 * 這個檔案同時鎖住「整數化不改變任何遊戲行為」：涵蓋半徑、通勤評分、
 * 消防反應時間三個下游量都必須與整數化前一致。
 */

import { describe, it, expect } from 'vitest';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { roadTileCost, ROAD_COVERAGE } from '../RoadCoverageFlood';
import { scoreCommuteByCost, COMMUTE_SCORE } from '../../citizen/WorkplaceScore';
import { DEFAULT_JOB_RELOCATION_CONFIG } from '../../citizen/JobRelocation';
import { FIRE } from '../FireService';

/** 整數化的放大倍率：新成本 = 舊浮點成本 × 18。 */
const SCALE = 18;

const DRIVABLE = [
  RoadType.RURAL,
  RoadType.TWO_LANE,
  RoadType.FOUR_LANE,
  RoadType.SIX_LANE,
  RoadType.HIGHWAY,
  RoadType.ONE_WAY,
] as const;

/** 整數化**之前**的每格成本，凍結在這裡作為比對基準。 */
const OLD_TILE: Record<number, number> = {
  [RoadType.RURAL]: 100 / 30,
  [RoadType.TWO_LANE]: 100 / 50,
  [RoadType.FOUR_LANE]: 100 / 100,
  [RoadType.SIX_LANE]: 100 / 180,
  [RoadType.HIGHWAY]: 100 / 200,
  [RoadType.ONE_WAY]: 100 / 50,
};

/** 整數化**之前**的各項預算，凍結在這裡作為比對基準。 */
const OLD_BUDGET = {
  GARBAGE_BUDGET: 80,
  POLICE_BUDGET: 30,
  FIRE_BUDGET: 30,
  HEALTH_BUDGET: 40,
  DEATHCARE_BUDGET: 35,
  EDUCATION_ELEMENTARY_BUDGET: 20,
  EDUCATION_HIGHSCHOOL_BUDGET: 30,
  EDUCATION_UNIVERSITY_BUDGET: 45,
} as const;

const OLD_DIJKSTRA_MAX_BUDGET = 60;
const OLD_RESPONSE_SPEED = 2;

describe('道路成本整數化', () => {
  it('每一種可行駛道路的每格成本都是正整數', () => {
    for (const t of DRIVABLE) {
      const cost = roadTileCost(t);
      expect(cost, RoadType[t]).toBeGreaterThan(0);
      expect(Number.isInteger(cost), `${RoadType[t]} = ${cost}`).toBe(true);
    }
  });

  it('NONE 仍然是 Infinity（不可行駛的哨兵值，永遠不會被加總）', () => {
    expect(roadTileCost(RoadType.NONE)).toBe(Infinity);
  });

  it('每格成本恰好是舊浮點值的 18 倍', () => {
    for (const t of DRIVABLE) {
      expect(roadTileCost(t), RoadType[t]).toBeCloseTo(OLD_TILE[t]! * SCALE, 9);
    }
  });

  it('道路之間的相對快慢完全沒變', () => {
    // 兩兩比值必須與舊制相同 —— 這是「不改變遊戲平衡」的核心保證。
    for (const a of DRIVABLE) {
      for (const b of DRIVABLE) {
        expect(roadTileCost(a) / roadTileCost(b), `${RoadType[a]}/${RoadType[b]}`)
          .toBeCloseTo(OLD_TILE[a]! / OLD_TILE[b]!, 9);
      }
    }
  });

  it('路徑總成本與累加順序無關（逐位元相等）', () => {
    // 一條混合路型的路徑。舊制下正反累加會差 1.78e-15，整數制下必須完全相同。
    const path: RoadType[] = [
      RoadType.RURAL, RoadType.RURAL, RoadType.RURAL,
      RoadType.TWO_LANE, RoadType.TWO_LANE,
      RoadType.HIGHWAY, RoadType.SIX_LANE, RoadType.FOUR_LANE,
      RoadType.SIX_LANE, RoadType.ONE_WAY, RoadType.HIGHWAY,
    ];
    const sum = (types: readonly RoadType[]): number =>
      types.reduce((acc, t) => acc + roadTileCost(t), 0);

    const forward = sum(path);
    expect(sum([...path].reverse())).toBe(forward);

    // 更強的版本：所有旋轉排列都必須給出同一個位元。
    for (let shift = 1; shift < path.length; shift++) {
      const rotated = [...path.slice(shift), ...path.slice(0, shift)];
      expect(sum(rotated), `旋轉 ${shift}`).toBe(forward);
    }
  });

  it('舊的浮點成本確實通不過上面那條性質（說明為什麼要改）', () => {
    const oldSum = (types: readonly RoadType[]): number =>
      types.reduce((acc, t) => acc + OLD_TILE[t]!, 0);
    const p = [RoadType.RURAL, RoadType.RURAL, RoadType.RURAL, RoadType.TWO_LANE, RoadType.TWO_LANE];
    expect(oldSum(p)).not.toBe(oldSum([...p].reverse()));
  });

  it('每一種預算的涵蓋半徑（可走幾格）完全沒變', () => {
    for (const [name, oldBudget] of Object.entries(OLD_BUDGET)) {
      const newBudget = ROAD_COVERAGE[name as keyof typeof OLD_BUDGET];
      expect(newBudget, name).toBe(oldBudget * SCALE);
      for (const t of DRIVABLE) {
        expect(
          Math.floor(newBudget / roadTileCost(t)),
          `${name} × ${RoadType[t]}`,
        ).toBe(Math.floor(oldBudget / OLD_TILE[t]!));
      }
    }
  });

  it('換工作的 Dijkstra 預算涵蓋半徑也沒變', () => {
    const newBudget = DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget;
    expect(newBudget).toBe(OLD_DIJKSTRA_MAX_BUDGET * SCALE);
    for (const t of DRIVABLE) {
      expect(Math.floor(newBudget / roadTileCost(t)), RoadType[t])
        .toBe(Math.floor(OLD_DIJKSTRA_MAX_BUDGET / OLD_TILE[t]!));
    }
  });

  it('通勤評分對每一個可達成本都與舊制給出同一個分數', () => {
    // 列舉所有「整數成本的和」≤ dijkstraMaxBudget 的可達值，逐一比對。
    const weights = DRIVABLE.map(roadTileCost);
    const max = DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget;
    const reachable = new Set<number>([0]);
    const queue: number[] = [0];
    while (queue.length > 0) {
      const c = queue.pop()!;
      for (const w of weights) {
        const n = c + w;
        if (n <= max && !reachable.has(n)) {
          reachable.add(n);
          queue.push(n);
        }
      }
    }
    expect(reachable.size).toBeGreaterThan(500); // 不能是空轉的迴圈

    // 整數化**之前**的評分公式，常數原封不動搬過來。
    const oldScore = (cost: number): number => {
      if (cost <= 10) return 15;
      if (cost > 40) return -15;
      return Math.round(15 - (cost - 10) * (30 / 30));
    };

    for (const c of reachable) {
      expect(scoreCommuteByCost(c), `成本 ${c}（舊制 ${c / SCALE}）`).toBe(oldScore(c / SCALE));
    }
  });

  it('通勤評分的門檻常數同步放大', () => {
    expect(COMMUTE_SCORE.SHORT_DISTANCE).toBe(10 * SCALE);
    expect(COMMUTE_SCORE.LONG_DISTANCE).toBe(40 * SCALE);
    // 分數本身不是距離，不能放大。
    expect(COMMUTE_SCORE.SHORT_BONUS).toBe(15);
    expect(COMMUTE_SCORE.LONG_PENALTY).toBe(-15);
    expect(COMMUTE_SCORE.NO_PATH_PENALTY).toBe(-20);
  });

  it('消防反應速度同步放大，反應時間不變', () => {
    expect(FIRE.RESPONSE_SPEED).toBe(OLD_RESPONSE_SPEED * SCALE);
    // 反應時間 = 成本 / 速度。兩者同步 ×18 → 商不變。
    for (const t of DRIVABLE) {
      const tiles = 5;
      const newTime = (roadTileCost(t) * tiles) / FIRE.RESPONSE_SPEED;
      const oldTime = (OLD_TILE[t]! * tiles) / OLD_RESPONSE_SPEED;
      expect(newTime, RoadType[t]).toBeCloseTo(oldTime, 9);
    }
  });

  it('成本仍然由 speedLimit × 車道數推導（沒有寫死成查表）', () => {
    for (const t of DRIVABLE) {
      const cfg = ROAD_CONFIGS[t];
      expect(roadTileCost(t), RoadType[t])
        .toBe(ROAD_COVERAGE.BASE_COST / (cfg.speedLimit * (cfg.lanes / 2)));
    }
  });
});

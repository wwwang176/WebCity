/**
 * A characterization test for integer road costs.
 *
 * Why they are integers: floating-point addition is **not associative**. The reverse Dijkstra
 * (outward from a workplace) and the forward one (outward from a home) walk the same edges in
 * opposite orders, and with the old floating-point costs (RURAL = 100/30 = 3.333…) the totals
 * differed by around 1e-15:
 *
 *   10/3 + 10/3 + 10/3 + 2 + 2 === 14
 *   2 + 2 + 10/3 + 10/3 + 10/3 === 14.000000000000002
 *
 * Float64 does not help — this is about order, not precision. Integer addition is fully
 * commutative, so the two directions can be compared bit for bit with `.toBe`.
 *
 * This file also pins that integer costs change no game behaviour: coverage radius, commute
 * scoring and fire response time must all match what they were before.
 */

import { describe, it, expect } from 'vitest';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { roadTileCost, ROAD_COVERAGE } from '../RoadCoverageFlood';
import { scoreCommuteByCost, COMMUTE_SCORE } from '../../citizen/WorkplaceScore';
import { DEFAULT_JOB_RELOCATION_CONFIG } from '../../citizen/JobRelocation';
import { FIRE } from '../FireService';
import { distanceWeight } from '../GlobalCoverageService';
import { GarbageService } from '../GarbageService';
import { Grid } from '../../grid/Grid';

/** The scaling factor: the new cost is the old floating-point cost x18. */
const SCALE = 18;

const DRIVABLE = [
  RoadType.RURAL,
  RoadType.TWO_LANE,
  RoadType.FOUR_LANE,
  RoadType.SIX_LANE,
  RoadType.HIGHWAY,
  RoadType.ONE_WAY,
] as const;

/** The per-tile costs from **before** the change, frozen here as the baseline. */
const OLD_TILE: Record<number, number> = {
  [RoadType.RURAL]: 100 / 30,
  [RoadType.TWO_LANE]: 100 / 50,
  [RoadType.FOUR_LANE]: 100 / 100,
  [RoadType.SIX_LANE]: 100 / 180,
  [RoadType.HIGHWAY]: 100 / 200,
  [RoadType.ONE_WAY]: 100 / 50,
};

/** The budgets from **before** the change, frozen here as the baseline. */
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
    // Every pairwise ratio must match the old scale; this is the core guarantee that balance is
    // unchanged.
    for (const a of DRIVABLE) {
      for (const b of DRIVABLE) {
        expect(roadTileCost(a) / roadTileCost(b), `${RoadType[a]}/${RoadType[b]}`)
          .toBeCloseTo(OLD_TILE[a]! / OLD_TILE[b]!, 9);
      }
    }
  });

  it('路徑總成本與累加順序無關（逐位元相等）', () => {
    // A path of mixed road types. On the old scale, forward and reverse summation differed by
    // 1.78e-15; with integers they must be identical.
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

    // The stronger version: every rotation must give the same bits.
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
    // Enumerates every reachable sum of integer costs up to dijkstraMaxBudget and compares each.
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
    expect(reachable.size).toBeGreaterThan(500); // the loop must not be vacuous

    // The scoring formula from **before** the change, with its constants carried over verbatim.
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
    // The scores themselves are not distances and must not be scaled.
    expect(COMMUTE_SCORE.SHORT_BONUS).toBe(15);
    expect(COMMUTE_SCORE.LONG_PENALTY).toBe(-15);
    expect(COMMUTE_SCORE.NO_PATH_PENALTY).toBe(-20);
  });

  it('消防反應速度同步放大，反應時間不變', () => {
    expect(FIRE.RESPONSE_SPEED).toBe(OLD_RESPONSE_SPEED * SCALE);
    // Response time is cost over speed; scaling both by 18 leaves the quotient unchanged.
    for (const t of DRIVABLE) {
      const tiles = 5;
      const newTime = (roadTileCost(t) * tiles) / FIRE.RESPONSE_SPEED;
      const oldTime = (OLD_TILE[t]! * tiles) / OLD_RESPONSE_SPEED;
      expect(newTime, RoadType[t]).toBeCloseTo(oldTime, 9);
    }
  });

  it('垃圾車／靈車的距離加權分布沒變', () => {
    // `collectPending` selects at random weighted by 1/max(floor, cost), and that floor is on the
    // same scale as the cost. Missing it during the change shrinks the equal-weight plateau
    // around a facility to only the cost-0 cells and changes the distribution — exactly what the
    // first version of the change missed.
    //
    // What is compared is the **relative** distribution: multiplying every weight by a constant
    // does not affect weighted-random selection, so both are normalised first.
    const oldWeight = (oldCost: number): number => 1 / Math.max(1, oldCost);
    const oldCosts = [0, 0.5, 1, 2, 100 / 30, 5, 10, 20, 40, 80];

    const normalise = (ws: number[]): number[] => {
      const total = ws.reduce((a, b) => a + b, 0);
      return ws.map(w => w / total);
    };

    const oldDist = normalise(oldCosts.map(oldWeight));
    const newDist = normalise(oldCosts.map(c => distanceWeight(c * SCALE)));

    for (let i = 0; i < oldCosts.length; i++) {
      expect(newDist[i], `舊成本 ${oldCosts[i]} 的挑選機率變了`)
        .toBeCloseTo(oldDist[i]!, 12);
    }
  });

  it('距離加權的下限恰好是一格四線道（整數化前後同一個意思）', () => {
    // The old floor was a literal 1, and one four-lane tile cost exactly 1 on the old scale.
    // Expressed through roadTileCost, it survives another change of scale.
    const floor = roadTileCost(RoadType.FOUR_LANE);
    expect(distanceWeight(0), '成本 0 應該被下限夾住').toBe(1 / floor);
    expect(distanceWeight(floor), '剛好等於下限時仍是平台').toBe(1 / floor);
    expect(distanceWeight(roadTileCost(RoadType.RURAL)), '超過下限後才開始遞減')
      .toBeLessThan(1 / floor);
  });

  it('collectPending 真的用了 distanceWeight —— 接線也要測', () => {
    // The two tests above cover the pure function only: reverting the caller to a literal
    // `1 / Math.max(1, cost)` leaves them green. This one checks the wiring through the
    // **actual selection outcome**.
    //
    // Weighted random is roll = r x (wNear + wFar), picking the near one when
    // r <= wNear/(wNear+wFar). The correct and the incorrect floor give two different
    // thresholds; fixing the roll halfway between them separates them in one selection: correct
    // picks the far one, incorrect the near one.
    const grid = new Grid(10, 10);
    for (let x = 1; x < 10; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });

    const gs = new GarbageService();
    gs.addFacility(0, 0, 1);          // capacity 1, so only one bag is collected this tick
    gs.recalculateCoverage(grid);

    // A pair of cells straddling the weight floor, taken from the **actual** cost map.
    // Coordinates are not worked out by hand: the facility footprint and the seed reach together
    // decide which cells are 0.
    const floor = roadTileCost(RoadType.FOUR_LANE);
    const costs = [...gs.getCoveredCellsWithCost()].sort((a, b) => a[1] - b[1]);
    const nearEntry = costs.find(([, c]) => c < floor);
    const farEntry = [...costs].reverse().find(([, c]) => c > floor);

    expect(nearEntry, '涵蓋圖裡沒有低於權重下限的格子').toBeDefined();
    expect(farEntry, '涵蓋圖裡沒有高於權重下限的格子').toBeDefined();

    const [NEAR, cNear] = nearEntry!;
    const [FAR, cFar] = farEntry!;
    const [nx, ny] = NEAR.split(',').map(Number);
    const [fx, fy] = FAR.split(',').map(Number);

    const thresholdFor = (f: number): number => {
      const wn = 1 / Math.max(f, cNear), wf = 1 / Math.max(f, cFar);
      return wn / (wn + wf);
    };
    const good = thresholdFor(floor);   // correct: the floor is on the cost scale
    const bad = thresholdFor(1);        // incorrect: a literal 1 from the old scale

    // The roll is taken halfway between the two thresholds rather than chosen by hand.
    expect(bad - good, '兩個門檻之間沒有間隙，這條測試分辨不出東西')
      .toBeGreaterThan(0.01);
    const roll = (good + bad) / 2;

    gs.reportGarbage(nx!, ny!, 1);   // the near one is reported first, so it is entries[0]
    gs.reportGarbage(fx!, fy!, 1);

    const origRandom = Math.random;
    Math.random = () => roll;
    try { gs.tick(); } finally { Math.random = origRandom; }

    const left = gs.toJSON().pendingBags ?? [];
    expect(left.length, '應該只收走一袋').toBe(1);
    expect(`${left[0]!.x},${left[0]!.y}`, '收走的是近的那袋 —— 呼叫端沒有用 distanceWeight')
      .toBe(NEAR);
  });

  it('成本仍然由 speedLimit × 車道數推導（沒有寫死成查表）', () => {
    for (const t of DRIVABLE) {
      const cfg = ROAD_CONFIGS[t];
      expect(roadTileCost(t), RoadType[t])
        .toBe(ROAD_COVERAGE.BASE_COST / (cfg.speedLimit * (cfg.lanes / 2)));
    }
  });
});

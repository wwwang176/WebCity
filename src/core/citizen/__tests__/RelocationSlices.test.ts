import { describe, it, expect } from 'vitest';
import { relocationTick, DEFAULT_RELOCATION_CONFIG } from '../Relocation';
import type { HousingCandidate } from '../HousingScore';
import { EducationLevel, type Citizen } from '../types';

/**
 * 換房子一次要把每一位不開心的市民對全城住宅打一次分 —— 12 萬人實測 195ms，而
 * 速度 1 的一個 tick 只有 250ms（BUG-331）。
 *
 * 解法是**每次只叫一部分人來評估**，開得比較密。要釘的是「分批之後總量沒變」，
 * 以及「每一批都是獨立的一場會」—— 這一次不是把一份名單攤到幾十個 tick 上跑，
 * 那個做法讓候選住宅、入住數、誰還活著三份快照全部過期，補了三輪還在冒新的。
 */

function citizen(id: number, homeId: string, happiness: number): Citizen {
  return {
    id, name: `c${id}`, age: 100, lifeStage: 'ADULT', education: EducationLevel.NONE,
    educationProgress: 0, homeId, workplaceId: null, happiness, health: 100,
    incomeLevel: 'MEDIUM', unemployedSince: null,
  } as unknown as Citizen;
}

/** `level` 決定分數:學歷 NONE 偏好 level 1，差兩級 -10 分。 */
function candidate(pos: string, level: number): HousingCandidate {
  return {
    pos, capacity: 50, level, landValue: 128,
    groundPollution: 0, noisePollution: 0, serviceCoverage: 6, hasPark: false,
  };
}

/** 一批住在爛房子（level 3）、旁邊有好房子（level 1）的不開心市民。 */
function scenario(n: number) {
  const citizens: Citizen[] = [];
  for (let i = 0; i < n; i++) citizens.push(citizen(i + 1, 'bad', 10));
  const candidates = [candidate('bad', 3), candidate('good', 1)];
  candidates[1]!.capacity = n * 2;
  const occupancy = new Map<string, number>([['bad', n], ['good', 0]]);
  return { citizens, candidates, occupancy };
}

/** 把 id 分成 N 批的簡單規則（實作用的是雜湊，這裡只要「有分批」）。 */
const sliceOf = (n: number) => (c: Citizen) => c.id % n;

describe('分批評估', () => {
  it('should only consider citizens in the given slice', () => {
    // 分批沒接上的話，一次還是全部人 —— 成本完全沒降，而所有看數值的斷言都還是綠的。
    const { citizens, candidates, occupancy } = scenario(400);
    const pick = sliceOf(4);
    const { relocatedIds } = relocationTick(citizens, candidates, occupancy,
      undefined, (c) => pick(c) === 0);

    expect(relocatedIds.length).toBeGreaterThan(0);
    for (const id of relocatedIds) {
      const c = citizens.find(x => x.id === id)!;
      expect(pick(c), `市民 ${id} 不在這一批裡卻被搬了家`).toBe(0);
    }
  });

  it('should cover everyone across a full round of slices', () => {
    // 有人永遠輪不到的話，他會一直住在爛房子裡。
    const N = 4;
    const { citizens, candidates, occupancy } = scenario(400);
    const pick = sliceOf(N);
    const seen = new Set<number>();
    for (let s = 0; s < N; s++) {
      for (const c of citizens) if (pick(c) === s) seen.add(c.id);
    }
    expect(seen.size, '一輪沒有蓋到全部人').toBe(citizens.length);
  });

  it('should keep the relocation rate the same as one big pass', () => {
    // 上限是「這一批不開心的人的 5%」。批數 × 頻率與原本相同時，每個遊戲日搬走的
    // 人數也要相同 —— 上限改成算全城的話，一輪會搬掉 N 倍的人。
    const N = 4;
    const oneGo = scenario(400);
    const all = relocationTick(oneGo.citizens, oneGo.candidates, oneGo.occupancy);

    const sliced = scenario(400);
    const pick = sliceOf(N);
    let total = 0;
    for (let s = 0; s < N; s++) {
      total += relocationTick(sliced.citizens, sliced.candidates, sliced.occupancy,
        undefined, (c) => pick(c) === s).count;
    }
    // 每批各取自己的 5%，加起來就是全城的 5%。整除誤差容忍幾位。
    expect(Math.abs(total - all.count), `一次跑 ${all.count} 位，分 ${N} 批共 ${total} 位`)
      .toBeLessThanOrEqual(N);
  });

  it('should cap each call at 5% of that slice', () => {
    const N = 4;
    const { citizens, candidates, occupancy } = scenario(400);
    const pick = sliceOf(N);
    const { count } = relocationTick(citizens, candidates, occupancy,
      undefined, (c) => pick(c) === 0);
    const inSlice = citizens.filter(c => pick(c) === 0).length;
    expect(count).toBe(Math.floor(inSlice * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
  });

  it('should behave exactly as before when no slice is given', () => {
    // 省略 inSlice 等於全部人。既有呼叫端（與測試）不傳它。
    const a = scenario(300);
    const withoutArg = relocationTick(a.citizens, a.candidates, a.occupancy);
    const b = scenario(300);
    const withTrue = relocationTick(b.citizens, b.candidates, b.occupancy, undefined, () => true);
    expect(withoutArg.relocatedIds).toEqual(withTrue.relocatedIds);
  });

  it('should not move anyone when the slice is empty', () => {
    const { citizens, candidates, occupancy } = scenario(200);
    const { count } = relocationTick(citizens, candidates, occupancy, undefined, () => false);
    expect(count).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { relocationTick, DEFAULT_RELOCATION_CONFIG } from '../Relocation';
import { citizenSliceOf } from '../../simulation/CitizenSlicing';
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

  it('should cover everyone across a full round of the production hash', () => {
    // 用**實際的**分批規則跑完一圈，逐一認人。自己在測試裡寫一份 `id % N` 再遍歷
    // 全部 N，那是恆真的 —— 實作換了也不會紅。
    const N = 10;
    const { citizens, candidates, occupancy } = scenario(400);
    const seen = new Set<number>();
    for (let s = 0; s < N; s++) {
      for (const c of citizens) if (citizenSliceOf(c.id, N) === s) seen.add(c.id);
    }
    expect(seen.size, '一圈沒有蓋到全部人').toBe(citizens.length);
  });

  it('should keep a whole round within the city-wide 5% cap', () => {
    // **這是分批最容易搞砸的地方。** 讓每批各自取 5%，加起來不等於全城的 5%:
    // `Math.max(1, Math.floor(n × 0.05))` 每批各自取整，小批全部進位到 1。
    // 400 人分 4 批剛好整除，看不出問題 —— 這裡刻意用會產生餘數的數字。
    for (const [pop, N] of [[100, 10], [390, 10], [37, 10], [1000, 10]] as const) {
      const oneGo = scenario(pop);
      const all = relocationTick(oneGo.citizens, oneGo.candidates, oneGo.occupancy);

      const sliced = scenario(pop);
      const cycleQuota = Math.max(1,
        Math.floor(pop * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
      let total = 0;
      for (let s = 0; s < N; s++) {
        // 呼叫端算配額:階梯法，十批加起來剛好等於 cycleQuota。
        const quota = Math.floor((s + 1) * cycleQuota / N) - Math.floor(s * cycleQuota / N);
        total += relocationTick(sliced.citizens, sliced.candidates, sliced.occupancy,
          undefined, (c) => citizenSliceOf(c.id, N) === s, quota).count;
      }
      expect(total, `${pop} 人:一次跑 ${all.count} 位，分 ${N} 批共 ${total} 位`)
        .toBe(all.count);
    }
  });

  it('should honour an explicit quota exactly', () => {
    const { citizens, candidates, occupancy } = scenario(400);
    const { count } = relocationTick(citizens, candidates, occupancy,
      undefined, () => true, 7);
    expect(count, '配額沒有被遵守').toBe(7);
  });

  it('should ask inSlice once per citizen when a quota is given', () => {
    // 沒有 quota 時要先數一遍不開心的人，`inSlice` 會被問兩次。給了 quota 就不必數
    // —— 呼叫端因此不必保證 `inSlice` 是純函式。
    const { citizens, candidates, occupancy } = scenario(200);
    const asked = new Map<number, number>();
    relocationTick(citizens, candidates, occupancy, undefined,
      (c) => { asked.set(c.id, (asked.get(c.id) ?? 0) + 1); return true; }, 3);
    for (const [id, n] of asked) {
      expect(n, `市民 ${id} 被問了 ${n} 次`).toBe(1);
    }
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

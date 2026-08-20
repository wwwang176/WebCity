import { describe, it, expect } from 'vitest';
import { beginHousingRelocation, relocationTick, DEFAULT_RELOCATION_CONFIG } from '../Relocation';
import type { HousingCandidate } from '../HousingScore';
import { EducationLevel, type Citizen } from '../types';

/**
 * 換房子那一輪原本擠在一個 tick 裡跑完 —— 12 萬人實測 195ms，而速度 1 的一個 tick
 * 只有 250ms。昂貴的是**評估**不是搬遷:每一位不開心的市民都要把全城的候選住宅打
 * 一次分，而 5% 的上限只擋得住真的搬成的人。
 *
 * 切片器不減少總工作量，也**不改變任何決定** —— 這是這裡最要釘的一件事。
 */

function citizen(id: number, homeId: string, happiness: number): Citizen {
  return {
    id, name: `c${id}`, age: 100, lifeStage: 'ADULT', education: EducationLevel.NONE,
    educationProgress: 0, homeId, workplaceId: null, happiness, health: 100,
    incomeLevel: 'MEDIUM', unemployedSince: null,
  } as unknown as Citizen;
}

/** `level` 決定分數:學歷 NONE 偏好 level 1，差一級 10 分、差兩級 -10 分。 */
function candidate(pos: string, level: number, landValue = 128): HousingCandidate {
  return {
    pos, capacity: 50, level, landValue,
    groundPollution: 0, noisePollution: 0, serviceCoverage: 6, hasPark: false,
  };
}

/** 一批住在爛房子（level 3，NONE 學歷不喜歡）、旁邊有好房子（level 1）的不開心市民。 */
function scenario(n: number) {
  const citizens: Citizen[] = [];
  for (let i = 0; i < n; i++) citizens.push(citizen(i + 1, 'bad', 10));
  const candidates = [candidate('bad', 3), candidate('good', 1)];
  candidates[1]!.capacity = n * 2;
  const occupancy = new Map<string, number>([['bad', n], ['good', 0]]);
  return { citizens, candidates, occupancy };
}

describe('換房子的切片器', () => {
  it('should reach the same decisions whether sliced or run in one go', () => {
    // 切片不能改變任何決定。順序不能亂 —— occupancy 邊走邊改，後面的人看得到
    // 前面的決定。
    const a = scenario(400);
    const oneGo = relocationTick(a.citizens, a.candidates, a.occupancy);

    const b = scenario(400);
    const slicer = beginHousingRelocation(b.citizens, b.candidates, b.occupancy);
    const sliced: number[] = [];
    let guard = 0;
    while (slicer.pending > 0 && guard++ < 1000) sliced.push(...slicer.runSlice(7));

    expect(sliced, '切片跑出來的搬遷名單跟一次跑完不一樣').toEqual(oneGo.relocatedIds);
  });

  it('should never exceed the budget of evaluations in one slice', () => {
    // 額度就是這件事的重點。不封頂的話一整輪還是擠在一個 tick。
    const { citizens, candidates, occupancy } = scenario(400);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    const before = slicer.pending;
    slicer.runSlice(9);
    expect(before - slicer.pending, `一片就吃掉了 ${before - slicer.pending} 位`)
      .toBeLessThanOrEqual(9);
  });

  it('should drain to zero', () => {
    // 跳過的人也消耗額度的話，配額用完之後每一片都在空轉，pending 永遠降不到 0。
    const { citizens, candidates, occupancy } = scenario(300);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    let guard = 0;
    while (slicer.pending > 0 && guard++ < 500) slicer.runSlice(3);
    expect(slicer.pending, `跑了 ${guard} 片還沒收工`).toBe(0);
  });

  it('should stop once the relocation cap is reached', () => {
    // 5% 的上限。逐片重算上限的話，人陸續搬走之後上限會一路往下掉。
    const n = 400;
    const { citizens, candidates, occupancy } = scenario(n);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    const moved: number[] = [];
    let guard = 0;
    while (slicer.pending > 0 && guard++ < 1000) moved.push(...slicer.runSlice(5));
    expect(moved.length).toBe(Math.floor(n * DEFAULT_RELOCATION_CONFIG.maxRelocateRatio));
  });

  it('should skip a citizen whose home vanished mid-round', () => {
    // 名單是開輪時拍的，一輪要跑幾十個 tick。中間拆掉那一棟住宅，這個人的
    // homeId 會被清成 null —— 不擋的話後面拿它當 Map 的鍵。
    const { citizens, candidates, occupancy } = scenario(60);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    slicer.runSlice(5);
    for (const c of citizens) c.homeId = null;
    expect(() => {
      let guard = 0;
      while (slicer.pending > 0 && guard++ < 200) slicer.runSlice(5);
    }).not.toThrow();
    expect(slicer.pending, '房子沒了的人卡住了這一輪').toBe(0);
  });

  it('should skip a citizen who cheered up mid-round', () => {
    // 快樂度是分片更新的，一輪之內會變。開輪時不開心、輪到他時已經好了的人
    // 不該被搬走。
    const { citizens, candidates, occupancy } = scenario(200);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    for (const c of citizens) c.happiness = 90;
    const moved: number[] = [];
    let guard = 0;
    while (slicer.pending > 0 && guard++ < 500) moved.push(...slicer.runSlice(5));
    expect(moved, '所有人都已經開心了，還是有人被搬走').toEqual([]);
  });

  it('should not spend budget on citizens it skips', () => {
    // 跳過不做任何評分，所以不該吃額度。吃掉的話一輪要多花好幾倍的 tick 才跑得完，
    // 而那些 tick 什麼事也沒做。
    const { citizens, candidates, occupancy } = scenario(300);
    const slicer = beginHousingRelocation(citizens, candidates, occupancy);
    for (const c of citizens) c.happiness = 90;   // 全部變開心 = 全部會被跳過

    const before = slicer.pending;
    slicer.runSlice(5);
    expect(before - slicer.pending, '被跳過的人也吃掉了額度').toBeGreaterThan(5);
  });

  it('should report nothing pending when nobody is unhappy', () => {
    const citizens = [citizen(1, 'bad', 90)];
    const slicer = beginHousingRelocation(citizens, [candidate('bad', 3)], new Map());
    expect(slicer.pending).toBe(0);
  });

  it('should report nothing pending with no candidates', () => {
    const citizens = [citizen(1, 'bad', 10)];
    const slicer = beginHousingRelocation(citizens, [], new Map());
    expect(slicer.pending).toBe(0);
  });
});

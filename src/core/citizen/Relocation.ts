import type { Citizen } from './types';
import { type HousingCandidate, scoreHousing } from './HousingScore';

export interface RelocationConfig {
  happinessThreshold: number;  // 35
  scoreGap: number;            // 20
  maxRelocateRatio: number;    // 0.05
  tickInterval: number;        // 60
}

export const DEFAULT_RELOCATION_CONFIG: RelocationConfig = {
  happinessThreshold: 35,
  scoreGap: 20,
  maxRelocateRatio: 0.05,
  tickInterval: 60,
};

/**
 * 一輪換房子的**切片器**。
 *
 * 昂貴的是**評估**不是搬遷:每一位不開心的市民都要把全城的候選住宅打一次分，
 * 而只有分數差夠大的才會真的搬。搬遷有 5% 的上限，評估沒有 —— 沒搬成的人不算進
 * 上限，所以成本是 O(不開心人數 × 住宅數)。12 萬人實測整輪 195ms。
 *
 * 切片器**不減少總工作量**，也不改變任何決定:名單與順序在開輪時就定好，之後照著
 * 走。順序不能亂 —— `occupancy` 隨著搬遷邊走邊改，後面的市民看得到前面的決定。
 */
export interface HousingRelocationSlicer {
  /** 還沒評估的市民數。0 表示這一輪跑完了。 */
  readonly pending: number;
  /**
   * 評估下一片，最多做 `budget` 次評分。回傳這一片搬遷的市民 id。
   *
   * 被跳過的市民（已經不在城裡、房子被拆了、這時候已經不再不開心）**不消耗預算**
   * —— 讓它算一次的話，配額用完之後每一片都在空轉，`pending` 永遠降不到 0。
   */
  runSlice(budget: number): number[];
}

/**
 * 開一輪換房子，回傳切片器。
 *
 * 不開心的名單在這裡拍下來。一輪要跑幾十個 tick 才輪得到後面的人，中間可能有人
 * 遷出、房子被拆 —— 那些在 `runSlice` 裡逐一擋掉。
 */
export function beginHousingRelocation(
  // Read-only: the pass rewrites `homeId` on the citizens, never the array.
  citizens: readonly Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
  config?: Partial<RelocationConfig>,
): HousingRelocationSlicer {
  const cfg: RelocationConfig = config
    ? { ...DEFAULT_RELOCATION_CONFIG, ...config }
    : DEFAULT_RELOCATION_CONFIG;

  const unhappy: Citizen[] = [];
  if (candidates.length > 0) {
    for (const c of citizens) {
      if (c.homeId !== null && c.happiness < cfg.happinessThreshold) unhappy.push(c);
    }
  }

  // 上限用開輪時的人數算。逐片重算的話，隨著人陸續搬走上限會一路往下掉。
  const maxRelocations = Math.max(1, Math.floor(unhappy.length * cfg.maxRelocateRatio));
  // 現居住宅原本是每位市民 `candidates.find` 線性找一次。
  const byPos = new Map<string, HousingCandidate>();
  for (const c of candidates) byPos.set(c.pos, c);

  let cursor = 0;
  let relocated = 0;

  return {
    get pending(): number { return relocated >= maxRelocations ? 0 : unhappy.length - cursor; },
    runSlice(budget: number): number[] {
      const relocatedIds: number[] = [];
      let spent = 0;
      while (cursor < unhappy.length && spent < budget && relocated < maxRelocations) {
        const citizen = unhappy[cursor++]!;
        // 名單是開輪時拍的。這一輪跑到這裡可能已經過了幾十個 tick。
        const currentPos = citizen.homeId;
        if (currentPos === null || citizen.happiness >= cfg.happinessThreshold) continue;

        const currentCandidate = byPos.get(currentPos);
        if (!currentCandidate) continue;
        spent++;
        const currentScore = scoreHousing(citizen, currentCandidate);

        // Score alternatives inline (avoid .filter() array allocation)
        let bestCandidate: HousingCandidate | null = null;
        let bestScore = -Infinity;
        for (const c of candidates) {
          if (c.pos === currentPos) continue;
          const occ = occupancy.get(c.pos) ?? 0;
          if (occ >= c.capacity) continue;
          const s = scoreHousing(citizen, c);
          if (s > bestScore) {
            bestScore = s;
            bestCandidate = c;
          }
        }

        if (bestCandidate === null) continue;

        // Only relocate if the score gap is large enough
        if (bestScore - currentScore < cfg.scoreGap) continue;

        // Perform relocation
        const oldOcc = occupancy.get(currentPos) ?? 0;
        occupancy.set(currentPos, Math.max(0, oldOcc - 1));
        citizen.homeId = bestCandidate.pos;
        occupancy.set(bestCandidate.pos, (occupancy.get(bestCandidate.pos) ?? 0) + 1);

        relocated++;
        relocatedIds.push(citizen.id);
      }
      return relocatedIds;
    },
  };
}

/**
 * Attempt to relocate unhappy citizens to better housing.
 * Returns the number of citizens that were relocated.
 * Mutates citizens (homeId) and occupancy map in-place.
 *
 * 一次跑完整輪。SimulationLoop 走的是切片的路（`beginHousingRelocation`）——
 * 這個包裝留給測試與「就是要一次做完」的呼叫端。
 */
export function relocationTick(
  citizens: readonly Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
  config?: Partial<RelocationConfig>,
): { count: number; relocatedIds: number[] } {
  const relocatedIds = beginHousingRelocation(citizens, candidates, occupancy, config)
    .runSlice(Infinity);
  return { count: relocatedIds.length, relocatedIds };
}

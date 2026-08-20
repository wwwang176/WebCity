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
 * Attempt to relocate unhappy citizens to better housing.
 * Returns the number of citizens that were relocated.
 * Mutates citizens (homeId) and occupancy map in-place.
 *
 * ### 為什麼有 `inSlice`
 *
 * 昂貴的是**評估**不是搬遷:每一位不開心的市民都要把全城的候選住宅打一次分，而
 * 只有分數差夠大的才會真的搬。搬遷有 5% 的上限，評估沒有 —— 沒搬成的人不算進
 * 上限，所以成本是 O(不開心人數 × 住宅數)。12 萬人實測一次 **195ms**，而速度 1
 * 的一個 tick 只有 250ms（BUG-331）。
 *
 * `inSlice` 讓呼叫端每次只叫**一部分市民**來評估。節奏因此變成「開得比較密、每次
 * 人比較少」，而不是「一場會拆成幾十天開」。
 *
 * 拆成幾十天開過一次，那是錯的:候選住宅、入住數、誰還活著，這三份資料在那幾十個
 * tick 裡全部會變，而拿著第一天印的資料一路用到最後一天，就會把人搬進已經拆掉的
 * 樓、已經住滿的樓，或幫已經過世的人搬家。補了三輪還在冒新的（BUG-331）。
 *
 * 現在每次呼叫都是**獨立的一場會**:當場拍快照、當場用完、當場丟掉，壽命一個 tick
 * —— 與最初的寫法完全相同，那一整類問題不存在。
 *
 * 上限是「**這一批**不開心的人的 5%」。批數 × 呼叫頻率設成與原本的節奏相同時，
 * 每個遊戲日搬走的人數也就與原本相同。
 */
export function relocationTick(
  // Read-only: the pass rewrites `homeId` on the citizens, never the array.
  citizens: readonly Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
  config?: Partial<RelocationConfig>,
  /** 這一位屬於這一批嗎。省略等於「全部人都算」。 */
  inSlice: (citizen: Citizen) => boolean = () => true,
): { count: number; relocatedIds: number[] } {
  const cfg: RelocationConfig = config
    ? { ...DEFAULT_RELOCATION_CONFIG, ...config }
    : DEFAULT_RELOCATION_CONFIG;

  if (candidates.length === 0) return { count: 0, relocatedIds: [] };

  // Count unhappy citizens inline (avoid .filter() array allocation)
  let unhappyCount = 0;
  for (const c of citizens) {
    if (c.homeId !== null && c.happiness < cfg.happinessThreshold && inSlice(c)) unhappyCount++;
  }
  if (unhappyCount === 0) return { count: 0, relocatedIds: [] };

  // Cap the number of relocations per call
  const maxRelocations = Math.max(1, Math.floor(unhappyCount * cfg.maxRelocateRatio));
  const relocatedIds: number[] = [];

  // 現居住宅原本是每位市民 `candidates.find` 線性找一次。
  const byPos = new Map<string, HousingCandidate>();
  for (const c of candidates) byPos.set(c.pos, c);

  for (const citizen of citizens) {
    if (relocatedIds.length >= maxRelocations) break;
    if (citizen.homeId === null || citizen.happiness >= cfg.happinessThreshold) continue;
    if (!inSlice(citizen)) continue;

    const currentPos = citizen.homeId;

    // Find the current home candidate to compute current score
    const currentCandidate = byPos.get(currentPos);
    if (!currentCandidate) continue;
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

    relocatedIds.push(citizen.id);
  }

  return { count: relocatedIds.length, relocatedIds };
}

import type { Citizen } from './types';
import { isWorkingAge } from './types';
import { scoreWorkplaceWithCost } from './WorkplaceScore';
import type { ZoneType } from '../grid/types';
import { parsePosKeyUnsafe, manhattanDistance } from '../grid/GridHelpers';
import type { ReadableGrid } from '../grid/GridHelpers';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { CachedRoute } from '../traffic/CommuteCache';

export interface WorkplaceCandidateWithZone {
  pos: string;
  capacity: number;
  zoneType: ZoneType;
}

export interface JobRelocationConfig {
  /** 通勤超過幾 tick 就想換工作。 */
  commuteTimeThreshold: number;
  /** 估不出通勤時間時的保底：直線距離超過幾格算太遠。 */
  manhattanFallback: number;
  happinessThreshold: number;
  scoreGap: number;
  maxRelocateRatio: number;
  tickInterval: number;
  dijkstraMaxBudget: number;
}

export const DEFAULT_JOB_RELOCATION_CONFIG: JobRelocationConfig = {
  /**
   * 實測六種城市加一份真實存檔的通勤時間分布定出來的：住商混合的小鎮中位數
   * 11、緊湊城市 24.7、真實存檔 42.9、分區而沒有大眾運輸的城市 70.2、塞爆的
   * 城市 108，而家與公司都在站旁邊的捷運族不管住多遠都在 34 以內。
   *
   * 60 這條線讓小鎮與緊湊城市幾乎不觸發、規劃糟的城市約四成的人想換工作，
   * 而捷運族一個都不會被抓 —— 這正是「住得遠但住在站附近」要成立的條件。
   */
  commuteTimeThreshold: 60,
  manhattanFallback: 15,
  happinessThreshold: 35,
  scoreGap: 15,
  maxRelocateRatio: 0.05,
  tickInterval: 120,
  /** 道路通行成本上限（見 `core/road/roadCost.ts`）。舊制 60，整數化後 ×18。 */
  dijkstraMaxBudget: 1080,
};

/** 這一趟通勤要花多久（tick）。估不出來時回傳非有限值。 */
export type CommuteTimeOf = (citizen: Citizen) => number;

/**
 * 這個人該不該考慮換工作，以及是不是緊急。
 *
 * 只有一條主要規則：**通勤要花多久**。距離仍然有代價（開車時間隨距離與壅塞上升），
 * 但那個代價可以被大眾運輸抵銷，所以「住得遠但住在站旁邊」不會被逼著換工作，
 * 而「住得近但天天塞車」會。
 *
 * 舊版是兩條互斥的規則 —— 有快取路線就看路徑長度、沒有就看直線距離。兩個門檻
 * 都沒在篩人（路徑長度 500 在 60×60 的城市裡永遠不成立；直線距離 15 命中 99.9%），
 * 而且規則取決於系統剛好算好了沒：修好載入時的快取覆蓋率之後，所有人都落進
 * 「有路線」那一邊，整個機制就靜靜地停擺了。
 */
function getTriggerReason(
  citizen: Citizen,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  config: JobRelocationConfig,
  commuteTimeOf: CommuteTimeOf,
): 'none' | 'failed' | 'long_commute' | 'unhappy' {
  const route = cache.get(citizen.id);

  if (route) {
    if (route.status === 'failed') return 'failed';
    // 路網剛改過，快取還沒重算。當成「走不到」會引發一波集體失業。
    if (route.generation !== cache.roadGeneration) return 'none';
  }

  const time = commuteTimeOf(citizen);
  if (Number.isFinite(time)) {
    if (time > config.commuteTimeThreshold) return 'long_commute';
  } else {
    // 估不出時間（路網剛建好、還沒有可及性圖）時的保底。
    const home = parsePosKeyUnsafe(citizen.homeId!);
    const work = parsePosKeyUnsafe(citizen.workplaceId!);
    if (manhattanDistance(home.x, home.y, work.x, work.y) > config.manhattanFallback) return 'long_commute';
  }

  if (citizen.happiness < config.happinessThreshold) return 'unhappy';

  return 'none';
}

/**
 * Job relocation tick: citizens with long/failed commutes or low happiness
 * attempt to switch to a closer/better workplace.
 * If the commute route is confirmed failed and no reachable workplace exists,
 * the citizen becomes unemployed (workplaceId = null).
 */
/** Optional distance lookup matching roadDistanceToTargets signature. */
export type DistanceLookup = (
  grid: ReadableGrid,
  homePos: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
) => Map<string, number>;

/**
 * 一輪換工作的**切片器**。
 *
 * 每個市民都要一次 Dijkstra（家 → 所有可能的工作），而那是這一輪唯一昂貴的
 * 東西 —— 2436 人的城市裡實測一次約 4.3 毫秒，整輪 1474 毫秒。全部擠在同一個
 * tick 就是每隔幾秒卡一下（BUG-109）。
 *
 * 切片器**不減少總工作量**，只是讓呼叫端能說「這一片最多做幾次」。決策完全
 * 不變：順序在開輪時就定好，之後照著走。
 */
export interface JobRelocationSlicer {
  /** 還沒處理的市民數。0 表示這一輪跑完了。 */
  readonly pending: number;
  /**
   * 處理下一片，最多做 `budget` 次距離查詢。回傳這一片搬遷的市民 id。
   *
   * 被配額擋下而跳過的市民**不消耗預算** —— 跳過不做 Dijkstra，讓它算一次的話，
   * 配額用完之後每一片都在空轉，`pending` 永遠降不到 0。
   */
  runSlice(budget: number): number[];
}

/**
 * 開一輪換工作，回傳切片器。
 *
 * 順序在這裡就定死：先所有**走不到**的（緊急），再所有**通勤太長**的（非緊急）。
 * 這與原本兩輪迴圈的結果完全相同，但只算一次 `getTriggerReason`。
 *
 * 順序不能亂 —— `occupancy` 隨著搬遷邊走邊改，後面的市民看得到前面的決定。
 */
export function beginJobRelocation(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidateWithZone[],
  occupancy: Map<string, number>,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  grid: ReadableGrid,
  currentTick: number,
  config?: Partial<JobRelocationConfig>,
  distanceLookup?: DistanceLookup,
  commuteTimeOf: CommuteTimeOf = () => NaN,
): JobRelocationSlicer {
  const cfg: JobRelocationConfig = config
    ? { ...DEFAULT_JOB_RELOCATION_CONFIG, ...config }
    : DEFAULT_JOB_RELOCATION_CONFIG;

  const urgent: { citizen: Citizen; reason: string }[] = [];
  const nonUrgent: { citizen: Citizen; reason: string }[] = [];

  if (candidates.length > 0) {
    for (const c of citizens) {
      if (c.workplaceId === null || c.homeId === null || !isWorkingAge(c.age)) continue;
      const reason = getTriggerReason(c, cache, cfg, commuteTimeOf);
      if (reason === 'none') continue;
      (reason === 'failed' ? urgent : nonUrgent).push({ citizen: c, reason });
    }
  }

  const ordered = [...urgent, ...nonUrgent];
  const maxNonUrgent = Math.max(1, Math.floor(nonUrgent.length * cfg.maxRelocateRatio));
  const lookup = distanceLookup ?? roadDistanceToTargets;

  let cursor = 0;
  let nonUrgentCount = 0;

  return {
    get pending(): number { return ordered.length - cursor; },
    runSlice(budget: number): number[] {
      const relocatedIds: number[] = [];
      let spent = 0;
      while (cursor < ordered.length && spent < budget) {
        const { citizen, reason } = ordered[cursor++]!;
        if (reason !== 'failed' && nonUrgentCount >= maxNonUrgent) continue;
        // 名單是開一輪的時候拍下來的，而一輪要跑幾十個 tick 才輪得到這一位。
        // 中間拆掉那一棟住宅，這個人的 homeId 就成了 null（`Reconcile` 會清掉），
        // 而底下是拿 `!` 直接送進 parsePosKeyUnsafe 的 —— 會丟例外。
        if (citizen.homeId === null) continue;
        spent++;
    const currentPos = citizen.workplaceId!;
    const homePos = parsePosKeyUnsafe(citizen.homeId);

    // Find current workplace's zoneType
    const currentCandidate = candidates.find(c => c.pos === currentPos);
    const currentZoneType = currentCandidate?.zoneType;

    // Build target set inline (avoid .filter() + .map() arrays)
    const targetSet = new Set<string>();
    targetSet.add(currentPos);
    let hasAlternatives = false;
    for (const c of candidates) {
      if (c.pos === currentPos) continue;
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ < c.capacity) {
        targetSet.add(c.pos);
        hasAlternatives = true;
      }
    }

    if (!hasAlternatives) {
      // No alternatives — only become unemployed if route is failed AND current unreachable
      if (reason === 'failed') {
        const distCheck = lookup(grid, homePos, new Set([currentPos]), cfg.dijkstraMaxBudget);
        if (!distCheck.has(currentPos)) {
          const oldOcc = occupancy.get(currentPos) ?? 0;
          occupancy.set(currentPos, Math.max(0, oldOcc - 1));
          (citizen as Citizen).workplaceId = null;
          (citizen as Citizen).unemployedSince = currentTick;
          relocatedIds.push(citizen.id);
        }
      }
      continue;
    }

    // Dijkstra from home to all targets
    const distMap = lookup(grid, homePos, targetSet, cfg.dijkstraMaxBudget);

    // Score current workplace
    const currentScore = currentZoneType !== undefined
      ? scoreWorkplaceWithCost(citizen, currentZoneType, distMap.get(currentPos) ?? null)
      : -Infinity;

    // Score alternatives inline and find best
    let bestCandidate: WorkplaceCandidateWithZone | null = null;
    let bestScore = -Infinity;
    for (const alt of candidates) {
      if (alt.pos === currentPos) continue;
      const occ = occupancy.get(alt.pos) ?? 0;
      if (occ >= alt.capacity) continue;
      const score = scoreWorkplaceWithCost(citizen, alt.zoneType, distMap.get(alt.pos) ?? null);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = alt;
      }
    }

    if (bestCandidate !== null && bestScore - currentScore >= cfg.scoreGap) {
      // Relocate to better workplace
      const oldOcc = occupancy.get(currentPos) ?? 0;
      occupancy.set(currentPos, Math.max(0, oldOcc - 1));
      citizen.workplaceId = bestCandidate.pos;
      (citizen as Citizen).unemployedSince = null;
      occupancy.set(bestCandidate.pos, (occupancy.get(bestCandidate.pos) ?? 0) + 1);
      relocatedIds.push(citizen.id);
      if (reason !== 'failed') nonUrgentCount++;
    } else if (reason === 'failed') {
      // Route confirmed failed — current workplace unreachable
      // Try to pick any reachable alternative (even without scoreGap)
      let reachableAlt: WorkplaceCandidateWithZone | null = null;
      let reachableScore = -Infinity;
      for (const alt of candidates) {
        if (alt.pos === currentPos) continue;
        const occ = occupancy.get(alt.pos) ?? 0;
        if (occ >= alt.capacity) continue;
        if (!distMap.has(alt.pos)) continue;
        const score = scoreWorkplaceWithCost(citizen, alt.zoneType, distMap.get(alt.pos)!);
        if (score > reachableScore) {
          reachableScore = score;
          reachableAlt = alt;
        }
      }

      const oldOcc = occupancy.get(currentPos) ?? 0;
      occupancy.set(currentPos, Math.max(0, oldOcc - 1));

      if (reachableAlt) {
        citizen.workplaceId = reachableAlt.pos;
        (citizen as Citizen).unemployedSince = null;
        occupancy.set(reachableAlt.pos, (occupancy.get(reachableAlt.pos) ?? 0) + 1);
      } else {
        // No reachable alternative — become unemployed
        (citizen as Citizen).workplaceId = null;
        (citizen as Citizen).unemployedSince = currentTick;
      }
      relocatedIds.push(citizen.id);
    }
      }
      return relocatedIds;
    },
  };
}

/**
 * 跑完整輪換工作。等同於「開一輪，然後一次跑完」—— 只有這一個實作，所以
 * 切片與一次跑完不可能給出不同的決策。
 */
export function jobRelocationTick(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidateWithZone[],
  occupancy: Map<string, number>,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  grid: ReadableGrid,
  currentTick: number,
  config?: Partial<JobRelocationConfig>,
  distanceLookup?: DistanceLookup,
  commuteTimeOf?: CommuteTimeOf,
): { count: number; relocatedIds: number[] } {
  const slicer = beginJobRelocation(
    citizens, candidates, occupancy, cache, grid, currentTick, config, distanceLookup, commuteTimeOf,
  );
  const relocatedIds = slicer.runSlice(Infinity);
  return { count: relocatedIds.length, relocatedIds };
}

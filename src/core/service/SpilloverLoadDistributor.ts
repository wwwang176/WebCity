import type { LoadDemand, LoadDistributionResult } from './StationLoadDistributor';

/**
 * 近的優先，滿了就換下一座 —— 靈車的規矩。
 *
 * ## 為什麼不能只認最近的那一座
 *
 * 上一版把每一格的需求全部記在「沿馬路走過來最便宜的那一座」頭上。那修掉了歐氏
 * 直線的問題，卻造出一個新的:**所有人都擠到最近的那一間，第二近的那間永遠是空的**，
 * 即使它明明也涵蓋得到這一區。醫院顯示 230%，隔壁那間掛著 0%（BUG-365）。
 *
 * 而遊戲裡本來就有一個做對了的例子 —— 垃圾車與靈車
 * （`GlobalCoverageService.collectPending`）:
 *
 * ```ts
 * for (const [id, state] of facState) {
 *   if (state.budget <= 0 || state.room <= 0) continue;   // 滿了就跳過
 *   const cost = this.facilityDistanceMaps.get(id).get(posKey);
 *   if (cost !== undefined && cost < bestCost) { ... }     // 剩下的裡面挑最近的
 * }
 * ```
 *
 * 三件事:**只看涵蓋得到那一格的**、**滿了就換**、**在還有空位的裡面挑最近的**。
 * 這一支把同一個規矩用在警察、消防、醫療、學校上。
 *
 * ## 誰先挑
 *
 * 需求依「離自己最近的那座設施有多近」由近到遠處理 —— 緊鄰醫院的那一區先占走它，
 * 遠一點的才溢到第二近的。反過來的話，一個邊陲街區可以先把市中心的醫院占滿，
 * 而那不像任何現實中的就醫行為。
 *
 * 順序是**決定性的**（同成本時比 id），不用亂數:這份攤派每 6 個 tick 重算一次，
 * 亂數會讓面板上的數字自己跳動。靈車那邊用加權亂數是因為它在做**真的收運**
 * （每 tick 有預算上限），不是統計快照。
 *
 * ## 全部滿了怎麼辦
 *
 * 剩下的量記在**最近的那一座**頭上。硬性截在容量的話，沒有任何一座設施會超過
 * 100% —— 而「超載」正是這些數字存在的理由。
 */

export interface SpilloverFacility {
  id: string;
  capacity: number;
}

/** 涵蓋得到某一格的設施，**由近到遠**。 */
export interface CoveringFacility {
  id: string;
  cost: number;
}

export function distributeWithSpillover(
  facilities: readonly SpilloverFacility[],
  demands: readonly LoadDemand[],
  loadMap: Map<string, number>,
  coveringOf: (x: number, y: number) => readonly CoveringFacility[],
): LoadDistributionResult {
  loadMap.clear();

  let total = 0;
  for (let i = 0; i < demands.length; i++) total += demands[i]!.weight;

  if (facilities.length === 0) {
    return { loadRatio: total > 0 ? Infinity : 0, unassigned: total };
  }

  /** 還有多少空位。容量 0 的設施一開始就是滿的。 */
  const room = new Map<string, number>();
  let cap = 0;
  for (const f of facilities) {
    loadMap.set(f.id, 0);
    room.set(f.id, f.capacity);
    cap += f.capacity;
  }

  // 每一筆需求先問「涵蓋得到我的有誰」，然後依最近那一座的距離排隊。
  const queue: { weight: number; covering: readonly CoveringFacility[] }[] = [];
  let unassigned = 0;
  for (const d of demands) {
    // 名單上只留這一輪算數的設施 —— 覆蓋算過之後才被拆掉或斷電的不能再收需求。
    const covering = coveringOf(d.x, d.y).filter(c => room.has(c.id));
    if (covering.length === 0) {
      unassigned += d.weight;
      continue;
    }
    queue.push({ weight: d.weight, covering });
  }
  queue.sort((a, b) => {
    const byCost = a.covering[0]!.cost - b.covering[0]!.cost;
    // 同樣近時比 id —— 不比的話順序由呼叫端的迴圈決定，數字會無故跳動。
    return byCost !== 0 ? byCost : a.covering[0]!.id.localeCompare(b.covering[0]!.id);
  });

  for (const item of queue) {
    let left = item.weight;
    for (const c of item.covering) {
      if (left <= 0) break;
      const free = room.get(c.id)!;
      if (free <= 0) continue;
      const take = Math.min(left, free);
      loadMap.set(c.id, loadMap.get(c.id)! + take);
      room.set(c.id, free - take);
      left -= take;
    }
    // 全部滿了。剩下的記在最近的那一座 —— 截掉的話沒有人會超過 100%，
    // 而「超載」正是這些數字要講的事。
    if (left > 0) {
      const nearest = item.covering[0]!.id;
      loadMap.set(nearest, loadMap.get(nearest)! + left);
    }
  }

  return {
    loadRatio: cap > 0 ? total / cap : (total > 0 ? Infinity : 0),
    unassigned,
  };
}

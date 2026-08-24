/**
 * TransferTracker — Extracted from SimulationLoop (SRP).
 *
 * Manages multi-modal transfer usage tracking:
 * - 7-day rolling ring buffer of transfer usage per route label
 * - Today's transfer counts
 * - Per-building tracking of which homes/workplaces use each transfer route
 * - Pedestrian snapshot for UI display
 *
 * Pure state management — no simulation logic.
 */

export interface TransferHistoryData {
  history: Map<string, number>[];
  index: number;
  today: Map<string, number>;
  pedsSnapshot: number;
  lastDay: number;
}

export class TransferTracker {
  /** Rolling 7-day ring buffer of transfer usage per route label. */
  private history: Map<string, number>[] = Array.from({ length: 7 }, () => new Map());
  private historyIndex = 0;
  private today = new Map<string, number>();
  private lastDay = -1;
  private pedsSnapshot = 0;

  /** Recent buildings using each transfer route label → {homes, works} position sets. */
  private buildingsRecent = new Map<string, { homes: Set<string>; works: Set<string> }>();

  /** Callback fired when daily data rolls over. */
  onDataChanged: (() => void) | null = null;

  /**
   * Record a transfer trip for the given route label.
   *
   * @param count How many citizens this entry stands for. The spawn loop samples, so an
   *   undersampled entry is scaled back up (BUG-328).
   */
  recordTransfer(label: string, count = 1): void {
    this.today.set(label, (this.today.get(label) ?? 0) + count);
  }

  /** Record a building that used a transfer route. */
  recordBuilding(label: string, homeId: string, workplaceId: string): void {
    let bldgs = this.buildingsRecent.get(label);
    if (!bldgs) {
      bldgs = { homes: new Set(), works: new Set() };
      this.buildingsRecent.set(label, bldgs);
    }
    bldgs.homes.add(homeId);
    bldgs.works.add(workplaceId);
  }

  /** Clear building tracking (called when transfer graph rebuilds). */
  clearBuildings(): void {
    this.buildingsRecent.clear();
  }

  /** Roll over daily counts: flush today into ring buffer, reset today. */
  rolloverDay(activePedCount: number): void {
    this.history[this.historyIndex] = new Map(this.today);
    this.historyIndex = (this.historyIndex + 1) % 7;
    this.today.clear();
    this.pedsSnapshot = activePedCount;
    this.onDataChanged?.();
  }

  /** Get the weekly total for a specific label. */
  getWeeklyTotal(label: string): number {
    let total = 0;
    for (const dayMap of this.history) {
      total += dayMap.get(label) ?? 0;
    }
    total += this.today.get(label) ?? 0;
    return total;
  }

  /** Get all weekly totals across all labels. */
  getAllWeeklyTotals(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const dayMap of this.history) {
      for (const [label, count] of dayMap) {
        totals.set(label, (totals.get(label) ?? 0) + count);
      }
    }
    for (const [label, count] of this.today) {
      totals.set(label, (totals.get(label) ?? 0) + count);
    }
    return totals;
  }

  /** Get buildings that recently used a specific transfer route label. */
  getBuildings(label: string): { homes: string[]; works: string[] } {
    const bldgs = this.buildingsRecent.get(label);
    if (!bldgs) return { homes: [], works: [] };
    return { homes: [...bldgs.homes], works: [...bldgs.works] };
  }

  /** Get current snapshot state (for save/load and UI). */
  getHistory(): TransferHistoryData {
    return {
      history: this.history,
      index: this.historyIndex,
      today: this.today,
      pedsSnapshot: this.pedsSnapshot,
      lastDay: this.lastDay,
    };
  }

  /** Restore snapshot state (for save/load). */
  setHistory(data: TransferHistoryData): void {
    this.history = data.history;
    this.historyIndex = data.index;
    this.today = data.today;
    this.pedsSnapshot = data.pedsSnapshot;
    if (data.lastDay !== undefined) this.lastDay = data.lastDay;
  }

  /** Get lastDay for daily rollover check. */
  getLastDay(): number { return this.lastDay; }

  /** Set lastDay (for daily rollover check). */
  setLastDay(day: number): void { this.lastDay = day; }

  /** Get the pedestrian snapshot count. */
  getPedsSnapshot(): number { return this.pedsSnapshot; }

  /** Get today's transfer counts (for spawnCommuteVehicles). */
  getToday(): Map<string, number> { return this.today; }
}

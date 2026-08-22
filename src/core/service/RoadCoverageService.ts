import { isFootprintAdjacentToRoad, isFootprintNearRoad, type SizedGrid } from '../grid/GridHelpers';
import { RoadCoverageMap } from './RoadCoverageFlood';
import type { ServiceFacilityProvider } from '../traffic/ServiceVehicleManager';
import { removeById } from '../utils/removeById';
import { RESERVED_TO_ROTATION } from '../building/InfraPlacement';

/** Minimum facility shape: must have id and position. */
export interface Facility {
  id: string;
  x: number;
  y: number;
}

/**
 * Abstract base class for civic services that use road-distance coverage.
 * Eliminates duplicate getCoverage/getCostRatio/recalculateCoverage/previewCoverage
 * across PoliceService, HealthService, GarbageService, DeathCareService, etc.
 *
 * Subclasses provide:
 * - coverageBudget: road-distance budget for coverage flood
 * - defaultFacilityWidth/Height: building footprint for coverage origin
 * - idPrefix: e.g. "police_", "hospital_"
 */
export abstract class RoadCoverageService<F extends Facility> implements ServiceFacilityProvider {
  protected facilities: F[] = [];
  protected coverage = new RoadCoverageMap();
  protected connectedFacilityIds = new Set<string>();
  /**
   * 上一次重算覆蓋時餵給洪水的那份清單的 id，**順序就是擁有者索引**。
   *
   * 存 id 而不是設施本身:設施陣列會被增刪，而擁有者索引是那一次重算的快照。
   * 拿舊索引去查新陣列會指到別的設施。
   */
  private coveredFacilityIds: string[] = [];
  /** null = no filter (all operational); Set = only listed IDs are operational. */
  protected operationalIds: Set<string> | null = null;
  protected nextId = 1;

  protected abstract readonly coverageBudget: number;
  protected abstract readonly defaultFacilityWidth: number;
  protected abstract readonly defaultFacilityHeight: number;
  protected abstract readonly idPrefix: string;
  /** Maintenance cost per facility (used by default getMaintenanceCost). */
  protected abstract readonly maintenanceCostPerFacility: number;
  /**
   * Chebyshev distance within which a road must exist for a facility to count
   * as connected. Default 1 = strictly orthogonally adjacent. Civic subclasses
   * (police/fire/hospital/schools/cemetery) override to 2 so they may sit one
   * empty tile away from a road — matching their InfraConfig.roadReach.
   */
  protected readonly roadReach: 1 | 2 = 1;

  /** Generate a unique ID for a new facility. */
  protected generateId(): string {
    return `${this.idPrefix}${this.nextId++}`;
  }

  /** Push a facility and mark it connected + operational (placement requires road adjacency). */
  protected pushFacility(f: F): void {
    this.facilities.push(f);
    this.connectedFacilityIds.add(f.id);
    if (this.operationalIds) this.operationalIds.add(f.id);
  }

  /** Restore nextId from loaded facilities (for fromJSON). Also marks all loaded facilities as connected. */
  protected restoreNextId(): void {
    let max = 0;
    for (const f of this.facilities) {
      const n = parseInt(f.id.replace(this.idPrefix, ''), 10);
      if (n > max) max = n;
      this.connectedFacilityIds.add(f.id);
    }
    this.nextId = max + 1;
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverage.hasCoverage(x, y);
  }

  getCostRatio(x: number, y: number): number {
    return this.coverage.getCostRatio(x, y);
  }

  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.coverage.getCoveredCells();
  }

  /**
   * 涵蓋得到這一格的**每一座**設施，由近到遠。
   *
   * 「最近的那一座」不夠用 —— 它滿了的時候，需求應該溢到第二近的（靈車一直是這樣
   * 做的，見 `SpilloverLoadDistributor`）。上一版只認最近的那一座，於是所有人都擠到
   * 同一間，第二間永遠空著（BUG-365）。
   *
   * 上一次重算之後被拆掉的設施會被濾掉。
   */
  getCoveringFacilityIds(x: number, y: number): { id: string; cost: number }[] {
    const out: { id: string; cost: number }[] = [];
    for (const { index, cost } of this.coverage.getCoveringIndices(x, y)) {
      const id = this.coveredFacilityIds[index];
      if (id === undefined) continue;
      if (!this.facilities.some(f => f.id === id)) continue;
      out.push({ id, cost });
    }
    return out;
  }

  /**
   * 服務這一格的那一座設施 —— **還有空位的裡面最近的那一座**。
   *
   * 跟靈車同一個規矩。全部滿了就回最近的那一座（它就是會超載的那一座）。
   * 沒有任何設施涵蓋得到就回 `null`。
   */
  getServingFacilityId(x: number, y: number): string | null {
    const covering = this.getCoveringFacilityIds(x, y);
    if (covering.length === 0) return null;
    for (const c of covering) {
      const lc = this.facilityLoadOf(c.id);
      // 問不到負載（例如公園）就當作有空位 —— 沒有理由跳過最近的那一座。
      if (!lc) return c.id;
      if (lc.capacity > 0 && lc.load < lc.capacity) return c.id;
    }
    return covering[0]!.id;
  }

  /**
   * 服務這一格的那座設施現在多滿。`-1` = 沒有覆蓋。
   *
   * 「服務這一格的」是**還有空位的裡面最近的那一座** —— 所以最近那間滿了、
   * 第二間還很空時，這一格是被照顧到的，數字會反映第二間。全部滿了才會超過 1。
   *
   * 1.0 是剛好滿。**超過 1 是有意義的**（2.0 代表需求是容量的兩倍），所以不夾在 1。
   * 容量 0 而有需求時是 `Infinity` —— 那是「完全沒有能力」，不是「很空」。
   *
   * 子類別要能回報單一設施的負載與容量才有值,`facilityLoadOf` 預設回 `null`。
   */
  getLoadRatioAt(x: number, y: number): number {
    const id = this.getServingFacilityId(x, y);
    if (id === null) return -1;
    const lc = this.facilityLoadOf(id);
    if (!lc) return -1;
    if (lc.capacity <= 0) return lc.load > 0 ? Infinity : 0;
    return lc.load / lc.capacity;
  }

  /**
   * 單一設施的負載與容量。
   *
   * 預設 `null` —— 有些服務（公園）沒有負載的概念，硬掰一個 0 會讓圓點永遠是綠的
   * 而看起來像是「已經檢查過了」。
   */
  protected facilityLoadOf(_id: string): { load: number; capacity: number } | null {
    return null;
  }

  recalculateCoverage(grid: SizedGrid): void {
    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;
    const baseW = this.defaultFacilityWidth;
    const baseH = this.defaultFacilityHeight;
    const getSize = (f: { x: number; y: number }) => {
      const cell = grid.getCell(f.x, f.y);
      const rotation = cell?.reserved !== undefined ? (RESERVED_TO_ROTATION[cell.reserved] ?? 0) : 0;
      const swapped = rotation === 90 || rotation === 270;
      return { w: swapped ? baseH : baseW, h: swapped ? baseW : baseH };
    };
    // Civic services (roadReach=2) need a wider seed ring so a facility sitting
    // one empty tile back from a road can still start the coverage flood.
    this.coverage.setSeedReach(this.roadReach);
    this.coverage.recalculate(active, grid, this.coverageBudget, baseW, baseH, getSize);
    this.coveredFacilityIds = active.map(f => f.id);
    this.updateConnectedFacilities(grid);
  }

  /** Recompute which facilities are within road reach of at least one road cell. */
  protected updateConnectedFacilities(grid: SizedGrid): void {
    this.connectedFacilityIds.clear();
    const baseW = this.defaultFacilityWidth;
    const baseH = this.defaultFacilityHeight;
    const reach = this.roadReach;
    for (const f of this.facilities) {
      const cell = grid.getCell(f.x, f.y);
      const rotation = cell?.reserved !== undefined ? (RESERVED_TO_ROTATION[cell.reserved] ?? 0) : 0;
      const swapped = rotation === 90 || rotation === 270;
      const w = swapped ? baseH : baseW;
      const h = swapped ? baseW : baseH;
      const connected = reach >= 2
        ? isFootprintNearRoad(grid, f.x, f.y, w, h, reach)
        : isFootprintAdjacentToRoad(grid, f.x, f.y, w, h);
      if (connected) {
        this.connectedFacilityIds.add(f.id);
      }
    }
  }

  /** Check if a facility is currently connected to a road. */
  isFacilityConnected(id: string): boolean {
    return this.connectedFacilityIds.has(id);
  }

  previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    this.coverage.setSeedReach(this.roadReach);
    return this.coverage.previewMerged(position, grid, this.coverageBudget, facilityWidth, facilityHeight);
  }

  /** Update which facilities are operational (have power + water).
   *  Returns true if the set changed (facility gained or lost operational status). */
  updateOperationalStatus(predicate: (f: F) => boolean): boolean {
    const next = new Set<string>();
    for (const f of this.facilities) {
      if (predicate(f)) next.add(f.id);
    }
    const prev = this.operationalIds;
    const changed = !prev || prev.size !== next.size || [...next].some(id => !prev.has(id));
    this.operationalIds = next;
    return changed;
  }

  /** Check if a facility is currently operational. Returns true if no filter is active. */
  isFacilityOperationalById(id: string): boolean {
    return this.operationalIds === null || this.operationalIds.has(id);
  }

  /** Return only operational facilities. */
  getOperationalFacilities(): readonly F[] {
    if (this.operationalIds === null) return this.facilities;
    return this.facilities.filter(f => this.operationalIds!.has(f.id));
  }

  /**
   * Facilities that actually work: powered AND reachable by road.
   *
   * getOperationalFacilities asks only the first half. Coverage spreads along
   * roads, so a facility with no road covers nobody — but the capacity sums
   * were built from the looser test and kept counting its places. Same name and
   * meaning as GlobalCoverageService.getActiveFacilities, which has asked both
   * questions since BUG-101.
   */
  getActiveFacilities(): readonly F[] {
    return this.getOperationalFacilities().filter(f => this.connectedFacilityIds.has(f.id));
  }

  /** Default maintenance cost: count × per-facility cost. Override for custom logic. */
  getMaintenanceCost(): number {
    return this.facilities.length * this.maintenanceCostPerFacility;
  }

  /** Get all facilities (read-only). Subclasses may alias this (e.g. getStations). */
  getFacilities(): readonly F[] {
    return this.facilities;
  }

  /** Remove a facility by ID. Override for custom cleanup (e.g. GarbageService overflow). */
  removeFacilityById(id: string): boolean {
    this.connectedFacilityIds.delete(id);
    return removeById(this.facilities, id);
  }

  /** ServiceFacilityProvider: return facility positions for service vehicle spawning. */
  getFacilityPositions(): ReadonlyArray<{ x: number; y: number }> {
    return this.facilities;
  }
}

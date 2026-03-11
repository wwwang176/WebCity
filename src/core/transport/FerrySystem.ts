import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';
import { findWaterPath, type WaterGrid, type WaterPathResult } from '../pathfinding/WaterPathfinder';

const FERRY_CONFIG: TransportSystemConfig = {
  type: TransportType.FERRY,
  // 邏輯速度（世界單位/tick），匹配渲染端視覺速度：
  // FERRY_VISUAL_SPEED(1.5) × base_tick_interval(0.25s) = 0.375
  speed: 0.375,
  capacity: 100,
  dwellTicks: 6,
  operatingCostPerVehicle: 200,
  affectedByCongestion: false,
};

export interface WaterChecker {
  isWater(x: number, y: number): boolean;
}

/** 渡輪的 A* 水路路徑（渲染端動畫用） */
interface VesselPathInfo {
  waterPath: Array<{ x: number; y: number }>;
}

export class FerrySystem extends BaseTransportSystem {
  private waterGrid: WaterGrid | null = null;
  /** 每艘渡輪的 A* 路徑資訊 */
  private vesselPaths = new Map<number, VesselPathInfo>();
  /** A* 路徑快取：key = "fromX,fromY>toX,toY"，路線建立時預計算 */
  private waterPathCache = new Map<string, WaterPathResult | null>();

  constructor() {
    super(FERRY_CONFIG);
  }

  /**
   * 設定水域網格，用於 A* 水路尋路。
   * 清除快取並為現有路線重新預計算。
   */
  setWaterGrid(grid: WaterGrid): void {
    this.waterGrid = grid;
    this.waterPathCache.clear();
    for (const route of this.routes) {
      this.precomputeRoutePaths(route);
    }
  }

  private pathCacheKey(from: { x: number; y: number }, to: { x: number; y: number }): string {
    return `${from.x},${from.y}>${to.x},${to.y}`;
  }

  /** 預計算路線所有航段的 A* 路徑並快取 */
  private precomputeRoutePaths(route: TransportRoute): void {
    if (!this.waterGrid) return;
    for (let i = 0; i < route.stops.length; i++) {
      const from = route.stops[i]!;
      const to = route.stops[(i + 1) % route.stops.length]!;
      const key = this.pathCacheKey(from, to);
      if (!this.waterPathCache.has(key)) {
        this.waterPathCache.set(key, findWaterPath(this.waterGrid, from, to));
      }
    }
  }

  /** 查詢快取的 A* 路徑，未命中則即時計算並快取 */
  private getCachedPath(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): WaterPathResult | null {
    const key = this.pathCacheKey(from, to);
    if (this.waterPathCache.has(key)) {
      return this.waterPathCache.get(key)!;
    }
    // 快取未命中 — 即時計算並存入
    const result = this.waterGrid ? findWaterPath(this.waterGrid, from, to) : null;
    this.waterPathCache.set(key, result);
    return result;
  }

  // ── Alias methods for Ferry-specific naming ─────────────────────

  /**
   * Add a dock. The dock must be adjacent to or on water.
   * @param waterChecker Optional checker -- if provided, will reject non-water tiles.
   * @returns The created dock, or null if the location is not on water.
   */
  addDock(
    x: number,
    y: number,
    waterChecker?: WaterChecker,
  ): TransportStop | null {
    if (waterChecker && !waterChecker.isWater(x, y)) {
      return null;
    }
    return this.addStop(x, y);
  }

  removeDock(dockId: number): void {
    this.removeStop(dockId);
  }

  protected override onRouteDissolved(routeId: number): void {
    for (const v of this.vehicles) {
      if (v.routeId === routeId) this.vesselPaths.delete(v.id);
    }
  }

  override createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route = super.createRoute(stops, vehicleCount);
    this.precomputeRoutePaths(route);
    return route;
  }

  /**
   * 驗證碼頭之間是否存在水路連通（使用快取）。
   */
  validateRouteConnectivity(docks: TransportStop[]): boolean {
    if (!this.waterGrid || docks.length < 2) return false;
    for (let i = 0; i < docks.length - 1; i++) {
      const result = this.getCachedPath(docks[i]!, docks[i + 1]!);
      if (!result) return false;
    }
    return true;
  }

  getVessels(): readonly TransportVehicle[] {
    return this.getVehicles();
  }

  getDocks(): readonly TransportStop[] {
    return this.getStops();
  }

  /** 取得渡輪的 A* 路徑（用於 heading 計算和渲染） */
  getVesselPath(vesselId: number): Array<{ x: number; y: number }> | null {
    const info = this.vesselPaths.get(vesselId);
    return info ? info.waterPath : null;
  }


  override removeVehicleFromRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    let idx = -1;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      if (this.vehicles[i]!.routeId === routeId) { idx = i; break; }
    }
    if (idx >= 0) {
      this.vesselPaths.delete(this.vehicles[idx]!.id);
      this.vehicles.splice(idx, 1);
    }
    route.vehicles--;
    route.operatingCost = route.vehicles * this.config.operatingCostPerVehicle;
  }

  override deleteRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    // 清除快取中此路線的航段路徑
    if (route) {
      for (let i = 0; i < route.stops.length; i++) {
        const from = route.stops[i]!;
        const to = route.stops[(i + 1) % route.stops.length]!;
        this.waterPathCache.delete(this.pathCacheKey(from, to));
      }
    }
    for (const v of this.vehicles) {
      if (v.routeId === routeId) this.vesselPaths.delete(v.id);
    }
    super.deleteRoute(routeId);
  }

  // ── Override tick methods for A* water pathing ──────────────────

  protected override onDepart(vehicle: TransportVehicle, route: TransportRoute): void {
    const nextDock = route.stops[vehicle.currentStopIndex]!;

    // 從快取取得 A* 路徑（路線建立時已預計算）
    const result = this.getCachedPath(vehicle.position, nextDock);
    if (result && result.path.length > 1) {
      this.vesselPaths.set(vehicle.id, {
        waterPath: result.path,
      });
      vehicle.travelTicks = Math.max(1, Math.ceil(result.distance / this.config.speed));
      return;
    }
    // No water path or no grid — fallback travelTicks already set by base
  }

  protected override onTravelComplete(vehicle: TransportVehicle): void {
    this.vesselPaths.delete(vehicle.id);
  }

  // ── Serialization ───────────────────────────────────────────────

  override toJSON() {
    const base = super.toJSON() as BaseTransportJSON;
    return {
      docks: base.stops,
      routes: base.routes,
      vessels: base.vehicles,
      nextDockId: base.nextStopId,
      nextRouteId: base.nextRouteId,
      nextVesselId: base.nextVehicleId,
    };
  }

  static fromJSON(data: ReturnType<FerrySystem['toJSON']>): FerrySystem {
    const baseData: BaseTransportJSON = {
      stops: data.docks,
      routes: data.routes,
      vehicles: data.vessels,
      nextStopId: data.nextDockId,
      nextRouteId: data.nextRouteId,
      nextVehicleId: data.nextVesselId,
    };
    return BaseTransportSystem.baseFromJSON(baseData, FERRY_CONFIG, FerrySystem);
  }
}

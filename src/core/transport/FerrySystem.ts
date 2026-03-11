import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';
import { findWaterPath, type WaterGrid } from '../pathfinding/WaterPathfinder';

const FERRY_CONFIG: TransportSystemConfig = {
  type: TransportType.FERRY,
  // 邏輯速度（世界單位/tick），匹配渲染端視覺速度：
  // FERRY_VISUAL_SPEED(1.5) × base_tick_interval(0.25s) = 0.375
  speed: 0.375,
  capacity: 100,
  dwellTicks: 3,
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

  constructor() {
    super(FERRY_CONFIG);
  }

  /**
   * 設定水域網格，用於 A* 水路尋路。
   */
  setWaterGrid(grid: WaterGrid): void {
    this.waterGrid = grid;
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
    // Clean up vessel paths for dissolved routes
    const dissolvedIds: number[] = [];
    for (const r of this.routes) {
      const filtered = r.stops.filter(s => s.id !== dockId);
      if (filtered.length < 2) dissolvedIds.push(r.id);
    }
    for (const v of this.vehicles) {
      if (dissolvedIds.includes(v.routeId)) this.vesselPaths.delete(v.id);
    }
    this.removeStop(dockId);
  }

  /**
   * 驗證碼頭之間是否存在水路連通。
   */
  validateRouteConnectivity(docks: TransportStop[]): boolean {
    if (!this.waterGrid || docks.length < 2) return false;
    for (let i = 0; i < docks.length - 1; i++) {
      const from = docks[i]!;
      const to = docks[i + 1]!;
      const result = findWaterPath(this.waterGrid, from, to);
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
    for (const v of this.vehicles) {
      if (v.routeId === routeId) this.vesselPaths.delete(v.id);
    }
    super.deleteRoute(routeId);
  }

  // ── Override tick methods for A* water pathing ──────────────────

  protected override onDepart(vehicle: TransportVehicle, route: TransportRoute): void {
    const nextDock = route.stops[vehicle.currentStopIndex]!;

    // 計算 A* 水路路徑
    if (this.waterGrid) {
      const result = findWaterPath(this.waterGrid, vehicle.position, nextDock);
      if (result && result.path.length > 1) {
        this.vesselPaths.set(vehicle.id, {
          waterPath: result.path,
        });
        vehicle.travelTicks = Math.max(1, Math.ceil(result.distance / this.config.speed));
        return;
      }
    }
    // No water path or no grid — fallback travelTicks already set by base
  }

  protected override tickTraveling(vehicle: TransportVehicle, route: TransportRoute): void {
    // 位置移動由渲染端動畫處理，此處只倒數 travelTicks
    vehicle.travelTicks--;
    if (vehicle.travelTicks <= 0) {
      const dock = route.stops[vehicle.currentStopIndex]!;
      vehicle.position = { x: dock.x, y: dock.y };
      vehicle.traveling = false;
      vehicle.atStop = true;
      vehicle.waitTicks = this.config.dwellTicks;
      this.onArrive(vehicle, dock);
      this.vesselPaths.delete(vehicle.id);
    }
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

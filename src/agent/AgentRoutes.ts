import type { TransportRoute, TransportStop } from '../core/transport/types';

/**
 * 路線管理 —— 建線、拆線、加減車。
 *
 * ## 為什麼中間要隔一層
 *
 * 四種運具建路線的方式**沒有一個一樣**:
 *
 * | | 怎麼建 | 會失敗嗎 |
 * |---|---|---|
 * | 公車 | `Game.createBusRoute()`，要沿著馬路做車道尋路 | 會 —— 站牌之間沒有路 |
 * | 地鐵 | `metro.createLine()` | 不會 |
 * | 鐵路 | `rail.createLine()`，還要指定客運或貨運 | 不會 |
 * | 渡輪 | 先驗水路連不連得通，再 `ferry.createRoute()` | 會 —— 走不到 |
 *
 * 那些差異包在各自的 `ModeAdapter` 裡（`index.ts` 組出來）。這個類別只做**四種運具
 * 共通的把關**:站牌在不在、夠不夠兩站、順序有沒有保住、路線 ID 是不是真的。
 *
 * ## 每一支都回結果物件，不丟例外
 *
 * 跟 `AgentApi.act()` 同一個規矩。呼叫端是程式，`{ ok: false, reason }` 讀得懂;
 * 而且**擋下來的時候一定沒有碰到遊戲** —— 測試盯著這件事。
 */

export type TransitMode = 'bus' | 'metro' | 'rail' | 'ferry';

export const TRANSIT_MODES: readonly TransitMode[] = ['bus', 'metro', 'rail', 'ferry'];

/** 一種運具對外要提供的六件事。 */
export interface ModeAdapter {
  stops(): readonly TransportStop[];
  listRoutes(): readonly TransportRoute[];
  /** 建不起來回 `null`（公車沒路、渡輪沒水路）。 */
  createRoute(stops: readonly TransportStop[], vehicleCount: number): TransportRoute | null;
  deleteRoute(routeId: number): void;
  addVehicle(routeId: number): void;
  removeVehicle(routeId: number): void;
}

export type RouteHost = Record<TransitMode, ModeAdapter>;

export interface StopInfo {
  id: number;
  x: number;
  y: number;
}

export interface RouteInfo {
  routeId: number;
  stopIds: number[];
  vehicleCount: number;
  /** 路線斷了（例如馬路被拆掉），暫停營運中。 */
  suspended: boolean;
}

export interface RouteResult {
  ok: boolean;
  mode: string;
  routeId?: number;
  stopIds?: number[];
  vehicleCount?: number;
  reason?: string;
}

export class AgentRoutes {
  constructor(private readonly host: Partial<RouteHost>) {}

  /** 動得了哪幾種運具。 */
  modes(): readonly TransitMode[] {
    return TRANSIT_MODES;
  }

  /** 這種運具已經蓋好的站牌。建路線要的 ID 從這裡來。 */
  stops(mode: string): StopInfo[] {
    const a = this.adapter(mode);
    if (!a) return [];
    return a.stops().map(s => ({ id: s.id, x: s.x, y: s.y }));
  }

  /** 這種運具現在跑著的路線。 */
  list(mode: string): RouteInfo[] {
    const a = this.adapter(mode);
    if (!a) return [];
    return a.listRoutes().map(r => ({
      routeId: r.id,
      stopIds: r.stops.map(s => s.id),
      vehicleCount: r.vehicles,
      suspended: r.suspended === true,
    }));
  }

  /**
   * 依序經過這幾個站牌建一條路線。
   *
   * `stopIds` 的**順序就是行駛順序** —— 不排序也不去重，3→1→2 跟 1→2→3 是兩條
   * 不同的路線。
   */
  create(mode: string, stopIds: readonly number[], vehicleCount = 1): RouteResult {
    const a = this.adapter(mode);
    if (!a) return { ok: false, mode, reason: `unknown transit mode: ${mode}` };

    if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
      return { ok: false, mode, reason: `vehicleCount must be a whole number of vehicles: ${vehicleCount}` };
    }
    if (stopIds.length < 2) {
      return { ok: false, mode, reason: `a route needs at least 2 stops, got ${stopIds.length}` };
    }

    const byId = new Map(a.stops().map(s => [s.id, s]));
    const chosen: TransportStop[] = [];
    for (const id of stopIds) {
      const s = byId.get(id);
      if (!s) return { ok: false, mode, reason: `no ${mode} stop with id ${id}` };
      chosen.push(s);
    }

    const route = a.createRoute(chosen, vehicleCount);
    if (!route) {
      // 公車走不到、渡輪划不過去。遊戲那一層已經判過，這裡只是把話說出來。
      return { ok: false, mode, stopIds: [...stopIds], reason: `${mode} cannot reach every stop on this route` };
    }
    return {
      ok: true, mode,
      routeId: route.id,
      stopIds: route.stops.map(s => s.id),
      vehicleCount: route.vehicles,
    };
  }

  delete(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      a.deleteRoute(r.id);
      return { ok: true, mode, routeId };
    });
  }

  addVehicle(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      a.addVehicle(r.id);
      return { ok: true, mode, routeId, vehicleCount: this.vehicleCount(mode, routeId) };
    });
  }

  removeVehicle(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      // 一台都沒有還去減的話，遊戲那邊會靜靜地什麼都不做，然後這裡回一個
      // `ok: true` 但實際上沒發生任何事的結果 —— 那比直接說不行更難查。
      if (r.vehicles <= 0) {
        return { ok: false, mode, routeId, vehicleCount: 0, reason: `${mode} route ${routeId} has no vehicles to remove` };
      }
      a.removeVehicle(r.id);
      return { ok: true, mode, routeId, vehicleCount: this.vehicleCount(mode, routeId) };
    });
  }

  // ── 內部 ────────────────────────────────────────────────────────

  private adapter(mode: string): ModeAdapter | null {
    return (TRANSIT_MODES as readonly string[]).includes(mode)
      ? this.host[mode as TransitMode] ?? null
      : null;
  }

  /**
   * 共通的前置:運具存不存在、路線 ID 是不是**這種運具**的。
   *
   * 每一種運具的路線 ID 各自從小開始編，撞號是常態 —— 所以只在自己這一份裡找。
   */
  private onRoute(
    mode: string,
    routeId: number,
    run: (a: ModeAdapter, route: TransportRoute) => RouteResult,
  ): RouteResult {
    const a = this.adapter(mode);
    if (!a) return { ok: false, mode, reason: `unknown transit mode: ${mode}` };
    const route = a.listRoutes().find(r => r.id === routeId);
    if (!route) return { ok: false, mode, routeId, reason: `no ${mode} route with id ${routeId}` };
    return run(a, route);
  }

  private vehicleCount(mode: string, routeId: number): number {
    return this.list(mode).find(r => r.routeId === routeId)?.vehicleCount ?? 0;
  }
}

/**
 * collectTransportRoutes — 收集所有交通路線資料供 TransportRouteRenderer 使用。
 *
 * 純邏輯模組，禁止 import Three.js。
 */

import type { BusSystem } from './BusSystem';
import type { MetroSystem } from './MetroSystem';
import type { RailSystem } from './RailSystem';
import type { FerrySystem } from './FerrySystem';
import type { TransportRoute } from './types';
import { PALETTE } from '../../ColorPalette';
import { ViewMode, getFocusedStopKind, type TransportStopKind } from '../ViewMode';

/** 路線渲染資料 */
export interface TransportRouteRenderData {
  routeId: number;
  system: 'BUS' | 'METRO' | 'RAIL' | 'FERRY';
  color: number;
  stops: { x: number; y: number }[];
  suspended?: boolean;
}

export interface RouteSystems {
  bus: BusSystem;
  metro: MetroSystem;
  rail: RailSystem;
  ferry: FerrySystem;
}

/** 各系統的路線顏色 */
const ROUTE_COLORS: Record<TransportRouteRenderData['system'], number> = {
  BUS: PALETTE.TRANSPORT.BUS,
  METRO: PALETTE.TRANSPORT.METRO,
  RAIL: PALETTE.TRANSPORT.RAIL,
  FERRY: PALETTE.TRANSPORT.FERRY,
};

/** ID prefix offsets to avoid cross-system route ID collision. */
export const ROUTE_ID_OFFSETS: Record<TransportRouteRenderData['system'], number> = {
  BUS: 10_000,
  METRO: 20_000,
  RAIL: 40_000,
  FERRY: 50_000,
} as const;

function mapRoute(
  route: TransportRoute,
  system: TransportRouteRenderData['system'],
  idOffset: number,
): TransportRouteRenderData {
  return {
    routeId: route.id + idOffset,
    system,
    color: route.suspended ? 0x666666 : ROUTE_COLORS[system],
    stops: route.stops.map(s => ({ x: s.x, y: s.y })),
    suspended: route.suspended,
  };
}

/**
 * 收集所有交通系統的路線資料，轉換為統一的渲染格式。
 */
export function collectTransportRoutes(systems: RouteSystems): TransportRouteRenderData[] {
  const result: TransportRouteRenderData[] = [];

  for (const route of systems.bus.getRoutes()) {
    result.push(mapRoute(route, 'BUS', ROUTE_ID_OFFSETS.BUS));
  }

  for (const line of systems.metro.getLines()) {
    result.push(mapRoute(line, 'METRO', ROUTE_ID_OFFSETS.METRO));
  }

  for (const line of systems.rail.getLines()) {
    result.push(mapRoute(line, 'RAIL', ROUTE_ID_OFFSETS.RAIL));
  }

  for (const route of systems.ferry.getRoutes()) {
    result.push(mapRoute(route, 'FERRY', ROUTE_ID_OFFSETS.FERRY));
  }

  return result;
}

const KIND_TO_SYSTEM: Record<TransportStopKind, TransportRouteRenderData['system']> = {
  bus: 'BUS', metro: 'METRO', rail: 'RAIL', ferry: 'FERRY',
};

/**
 * 哪些系統要在地面畫站與站之間的連線。
 *
 * 捷運不畫：地下模式本來就有 `MetroTunnelRenderer` 畫出真正的隧道，地面再疊一條
 * 直線虛線只是同一件事的第二種畫法。鐵路要畫 —— 軌道畫的是路線的**形狀**，連線
 * 畫的是**停靠順序**，兩者說的不是同一件事。
 */
const DRAWS_GROUND_LINE: Record<TransportRouteRenderData['system'], boolean> = {
  BUS: true, METRO: false, RAIL: true, FERRY: true,
};

/**
 * 這個視角該畫哪些路線連線。
 *
 * 路線圖是**進了聚焦才看的東西**：正常視角一條都不畫，聚焦某一種交通工具時只畫
 * 它自己的。原本反過來 —— 正常視角畫滿四色虛線，一進聚焦就全部清掉，於是點進
 * 「公車」想看路網的人，看到的是一張沒有線的地圖。
 */
export function filterRoutesForViewMode(
  routes: readonly TransportRouteRenderData[], mode: ViewMode,
): TransportRouteRenderData[] {
  const kind = getFocusedStopKind(mode);
  if (kind === null) return [];
  const system = KIND_TO_SYSTEM[kind];
  if (!DRAWS_GROUND_LINE[system]) return [];
  return routes.filter(r => r.system === system);
}

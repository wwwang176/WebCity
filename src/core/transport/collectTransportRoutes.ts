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

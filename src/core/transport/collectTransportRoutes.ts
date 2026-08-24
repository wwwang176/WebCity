/**
 * Collects every transit route for TransportRouteRenderer.
 *
 * Pure logic: must not import Three.js.
 */

import type { BusSystem } from './BusSystem';
import type { MetroSystem } from './MetroSystem';
import type { RailSystem } from './RailSystem';
import type { FerrySystem } from './FerrySystem';
import type { TransportRoute } from './types';
import { PALETTE } from '../../ColorPalette';
import { ViewMode, getFocusedStopKind, type TransportStopKind } from '../ViewMode';

/** Render data for one route. */
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

/** Route colour per system. */
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

/** Collects routes from every transit system into one render format. */
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
 * Which systems draw stop-to-stop connectors on the ground.
 *
 * Metro does not: `MetroTunnelRenderer` already draws the real tunnels in underground
 * mode, and a straight dashed line on the surface is a second drawing of the same thing.
 * Rail does: the track shows the route's **shape**, the connector shows its **stopping
 * order**, which are different statements.
 */
const DRAWS_GROUND_LINE: Record<TransportRouteRenderData['system'], boolean> = {
  BUS: true, METRO: false, RAIL: true, FERRY: true,
};

/**
 * Which route connectors this view mode draws.
 *
 * The route map is **something you enter a focus mode to see**: the normal view draws
 * none, and focusing one transport type draws only its own. The inverse — four colours of
 * dashes in the normal view, cleared on focus — leaves anyone who clicks "bus" to inspect
 * the network looking at a map with no lines.
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

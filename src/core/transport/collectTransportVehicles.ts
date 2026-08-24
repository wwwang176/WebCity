/**
 * Collects vehicles from the transit systems into one render format.
 *
 * Pure logic: must not import Three.js. The renderer (VehicleRenderer) picks a geometry
 * from the `type` field.
 *
 * Buses are not collected here — they are rendered via TrafficSimulation like ordinary
 * cars. See BUS-ROAD-MOVEMENT-PLAN.md.
 */

import type { RailSystem } from './RailSystem';
import type { FerrySystem } from './FerrySystem';
import type { TransportVehicle } from './types';

/** Render data for a transit vehicle, compatible with VehicleData. Metro trains live in
 *  MetroTunnelRenderer instead. */
export interface TransportVehicleRenderData {
  id: number;
  x: number;
  y: number;
  heading: number;
  type: 'transport_bus' | 'rail_train' | 'rail_carriage' | 'ferry' | 'airplane';
  laneOffset: number;
  /** World Y position override (used by airplane for altitude). */
  altitude?: number;
  /** Pitch angle in radians (nose up = positive, used by airplane during approach/climb). */
  pitch?: number;
  /** Roll angle in radians (right wing down = positive, used by airplane during turns). */
  roll?: number;
  /** Uniform scale override (e.g. 0.6 for smaller planes at S airports). */
  scale?: number;
}

export interface TransportSystems {
  rail: RailSystem;
  ferry: FerrySystem;
}

/** ID prefix offsets to avoid cross-system vehicle ID collision. */
export const VEHICLE_ID_OFFSETS: Record<TransportVehicleRenderData['type'], number> = {
  transport_bus: 100_000,
  rail_train: 400_000,
  rail_carriage: 400_000,
  ferry: 500_000,
  airplane: 800_000,
} as const;

function mapVehicle(
  v: TransportVehicle,
  type: TransportVehicleRenderData['type'],
  idOffset: number,
  route?: { stops: readonly { x: number; y: number }[] },
): TransportVehicleRenderData {
  // Heading points from the current stop towards the next one.
  let heading = 0;
  if (route && route.stops.length >= 2) {
    const curIdx = v.currentStopIndex;
    const nextIdx = (curIdx + 1) % route.stops.length;
    const cur = route.stops[curIdx];
    const next = route.stops[nextIdx];
    if (cur && next) {
      const dx = next.x - cur.x;
      const dy = next.y - cur.y;
      if (dx !== 0 || dy !== 0) {
        heading = Math.atan2(-dy, dx);
      }
    }
  }

  return {
    id: v.id + idOffset,
    x: v.position.x,
    y: v.position.y,
    heading,
    type,
    laneOffset: 0,
  };
}

/**
 * Collects vehicles from the non-bus transit systems into one render format.
 * Buses are rendered via TrafficSimulation.vehicles, which carry busState.
 */
export function collectTransportVehicles(systems: TransportSystems): TransportVehicleRenderData[] {
  const result: TransportVehicleRenderData[] = [];

  // Rail
  const railLines = systems.rail.getLines();
  for (const t of systems.rail.getTrains()) {
    const line = railLines.find(l => l.id === t.routeId);
    result.push(mapVehicle(t, 'rail_train', VEHICLE_ID_OFFSETS.rail_train, line));
  }

  // Ferry: position and heading are overridden by the renderer's animation; this only
  // supplies the base data.
  const ferryRoutes = systems.ferry.getRoutes();
  for (const v of systems.ferry.getVessels()) {
    const route = ferryRoutes.find(r => r.id === v.routeId);
    result.push(mapVehicle(v, 'ferry', VEHICLE_ID_OFFSETS.ferry, route));
  }

  return result;
}

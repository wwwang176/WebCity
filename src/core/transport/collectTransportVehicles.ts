/**
 * collectTransportVehicles — 將各交通系統的車輛資料收集為渲染層可用的統一格式。
 *
 * 這是純邏輯模組，禁止 import Three.js。
 * 渲染層 (VehicleRenderer) 根據 type 欄位選擇對應的幾何模型。
 *
 * NOTE: Bus vehicles are no longer collected here — they are rendered via
 * TrafficSimulation (same as regular cars). See BUS-ROAD-MOVEMENT-PLAN.md.
 */

import type { RailSystem } from './RailSystem';
import type { FerrySystem } from './FerrySystem';
import type { TransportVehicle } from './types';

/** 交通系統車輛渲染資料型別（與 VehicleData 相容）— metro_train 已移至 MetroTunnelRenderer */
export interface TransportVehicleRenderData {
  id: number;
  x: number;
  y: number;
  heading: number;
  type: 'transport_bus' | 'rail_train' | 'rail_carriage' | 'ferry';
  laneOffset: number;
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
} as const;

function mapVehicle(
  v: TransportVehicle,
  type: TransportVehicleRenderData['type'],
  idOffset: number,
  route?: { stops: readonly { x: number; y: number }[] },
): TransportVehicleRenderData {
  // 計算 heading：根據當前站與下一站的方向
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
 * 收集非公車交通系統的車輛資料，轉換為統一的渲染格式。
 * Bus vehicles are now rendered via TrafficSimulation.vehicles (with busState).
 */
export function collectTransportVehicles(systems: TransportSystems): TransportVehicleRenderData[] {
  const result: TransportVehicleRenderData[] = [];

  // Rail
  const railLines = systems.rail.getLines();
  for (const t of systems.rail.getTrains()) {
    const line = railLines.find(l => l.id === t.routeId);
    result.push(mapVehicle(t, 'rail_train', VEHICLE_ID_OFFSETS.rail_train, line));
  }

  // Ferry — 位置和 heading 由渲染端動畫覆蓋，此處僅提供基礎資料
  const ferryRoutes = systems.ferry.getRoutes();
  for (const v of systems.ferry.getVessels()) {
    const route = ferryRoutes.find(r => r.id === v.routeId);
    result.push(mapVehicle(v, 'ferry', VEHICLE_ID_OFFSETS.ferry, route));
  }

  return result;
}

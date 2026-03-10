/**
 * collectTransportVehicles — 將各交通系統的車輛資料收集為渲染層可用的統一格式。
 *
 * 這是純邏輯模組，禁止 import Three.js。
 * 渲染層 (VehicleRenderer) 根據 type 欄位選擇對應的幾何模型。
 */

import type { BusSystem } from './BusSystem';
import type { TramSystem } from './TramSystem';
import type { RailSystem } from './RailSystem';
import type { FerrySystem } from './FerrySystem';
import type { TaxiSystem } from './TaxiSystem';
import type { TransportVehicle } from './types';

/** 交通系統車輛渲染資料型別（與 VehicleData 相容）— metro_train 已移至 MetroTunnelRenderer */
export interface TransportVehicleRenderData {
  id: number;
  x: number;
  y: number;
  heading: number;
  type: 'transport_bus' | 'tram' | 'rail_train' | 'ferry' | 'taxi';
  laneOffset: number;
}

export interface TransportSystems {
  bus: BusSystem;
  tram: TramSystem;
  rail: RailSystem;
  ferry: FerrySystem;
  taxi: TaxiSystem;
}

// ID 前綴偏移量，避免跨系統碰撞（每個系統有自己的 ID 命名空間）
const ID_OFFSET_BUS = 100_000;
const ID_OFFSET_TRAM = 300_000;
const ID_OFFSET_RAIL = 400_000;
const ID_OFFSET_FERRY = 500_000;
const ID_OFFSET_TAXI = 600_000;

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
 * 收集所有交通系統的車輛資料，轉換為統一的渲染格式。
 */
export function collectTransportVehicles(systems: TransportSystems): TransportVehicleRenderData[] {
  const result: TransportVehicleRenderData[] = [];

  // Bus
  const busRoutes = systems.bus.getRoutes();
  for (const v of systems.bus.getVehicles()) {
    const route = busRoutes.find(r => r.id === v.routeId);
    result.push(mapVehicle(v, 'transport_bus', ID_OFFSET_BUS, route));
  }

  // Tram
  const tramRoutes = systems.tram.getRoutes();
  for (const v of systems.tram.getVehicles()) {
    const route = tramRoutes.find(r => r.id === v.routeId);
    result.push(mapVehicle(v, 'tram', ID_OFFSET_TRAM, route));
  }

  // Rail
  const railLines = systems.rail.getLines();
  for (const t of systems.rail.getTrains()) {
    const line = railLines.find(l => l.id === t.routeId);
    result.push(mapVehicle(t, 'rail_train', ID_OFFSET_RAIL, line));
  }

  // Ferry — 使用 A* 路徑計算 heading
  const ferryRoutes = systems.ferry.getRoutes();
  for (const v of systems.ferry.getVessels()) {
    const route = ferryRoutes.find(r => r.id === v.routeId);
    const base = mapVehicle(v, 'ferry', ID_OFFSET_FERRY, route);

    // 若有 A* 路徑，用路徑方向計算更精確的 heading
    const waterPath = systems.ferry.getVesselPath(v.id);
    if (waterPath && waterPath.length > 1) {
      const pathIdx = systems.ferry.getVesselPathIndex(v.id);
      const curIdx = Math.min(pathIdx, waterPath.length - 1);
      const nextIdx = Math.min(curIdx + 1, waterPath.length - 1);
      if (curIdx !== nextIdx) {
        const cur = waterPath[curIdx]!;
        const next = waterPath[nextIdx]!;
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        if (dx !== 0 || dy !== 0) {
          base.heading = Math.atan2(-dy, dx);
        }
      }
    }

    result.push(base);
  }

  // Taxi
  for (const v of systems.taxi.getVehicles()) {
    result.push(mapVehicle(v, 'taxi', ID_OFFSET_TAXI));
  }

  return result;
}

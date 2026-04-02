/**
 * ViewMode — 控制遊戲視角模式，影響各 renderer 的透明度與可見性。
 */
export enum ViewMode {
  /** 正常地面視角 */
  NORMAL = 'NORMAL',
  /** 地下模式（地鐵隧道可見，地面物體半透明） */
  UNDERGROUND = 'UNDERGROUND',
  /** 鐵路聚焦（軌道/火車/平交道全彩，其餘白模） */
  RAIL_FOCUS = 'RAIL_FOCUS',
  /** 渡輪聚焦（水面/渡輪全彩，其餘白模） */
  FERRY_FOCUS = 'FERRY_FOCUS',
  /** 公車聚焦（道路/公車全彩，其餘白模） */
  BUS_FOCUS = 'BUS_FOCUS',
  /** 轉乘路線聚焦（建築半透明，高亮轉乘相關建築） */
  TRANSFER_FOCUS = 'TRANSFER_FOCUS',
}

/** Road-based transport focus: roads stay visible, everything else dimmed. */
const ROAD_TRANSPORT_OPACITY = {
  building: 0.125,
  road: 1.0,
  terrain: 0.2,
  surfaceVehicle: 0.0,
  metroTunnel: 0.0,
  metroTrain: 0.0,
  track: 0.15,
  levelCrossing: 0.15,
};

/**
 * 各 renderer 在不同 ViewMode 下的透明度設定。
 */
export const VIEW_MODE_OPACITY: Record<ViewMode, {
  building: number;
  road: number;
  terrain: number;
  surfaceVehicle: number;
  metroTunnel: number;
  metroTrain: number;
  track: number;
  levelCrossing: number;
}> = {
  [ViewMode.NORMAL]: {
    building: 1.0,
    road: 1.0,
    terrain: 1.0,
    surfaceVehicle: 1.0,
    metroTunnel: 0.0,
    metroTrain: 0.0,
    track: 1.0,
    levelCrossing: 1.0,
  },
  [ViewMode.UNDERGROUND]: {
    building: 0.125,
    road: 0.15,
    terrain: 0.2,
    surfaceVehicle: 0.08,
    metroTunnel: 1.0,
    metroTrain: 1.0,
    track: 0.15,
    levelCrossing: 0.0,
  },
  [ViewMode.RAIL_FOCUS]: {
    building: 0.125,
    road: 0.15,
    terrain: 0.2,
    surfaceVehicle: 0.0,
    metroTunnel: 0.0,
    metroTrain: 0.0,
    track: 1.0,
    levelCrossing: 1.0,
  },
  [ViewMode.FERRY_FOCUS]: {
    building: 0.125,
    road: 0.15,
    terrain: 1.0,
    surfaceVehicle: 0.0,
    metroTunnel: 0.0,
    metroTrain: 0.0,
    track: 0.15,
    levelCrossing: 0.0,
  },
  [ViewMode.BUS_FOCUS]: { ...ROAD_TRANSPORT_OPACITY },
  [ViewMode.TRANSFER_FOCUS]: {
    building: 0.15,
    road: 0.6,
    terrain: 0.25,
    surfaceVehicle: 0.1,
    metroTunnel: 0.0,
    metroTrain: 0.0,
    track: 0.15,
    levelCrossing: 0.15,
  },
};

/** 地下模式隧道 Y 位置（負值 = 地面以下） */
export const UNDERGROUND_TUNNEL_Y = -0.15;

// ── Transport stop identification ──

export type TransportStopKind = 'bus' | 'metro' | 'rail' | 'ferry';

import { getInfraBuildingId } from './building/InfraConfig';

/** buildingId → transport stop type mapping */
export const TRANSPORT_STOP_IDS: Record<number, TransportStopKind> = {
  [getInfraBuildingId('bus_stop')]: 'bus',
  [getInfraBuildingId('metro_station')]: 'metro',
  [getInfraBuildingId('train_station')]: 'rail',
  [getInfraBuildingId('ferry_dock')]: 'ferry',
};

/** Get transport stop type from buildingId, or undefined if not a transport stop. */
export function getTransportStopType(buildingId: number): TransportStopKind | undefined {
  return TRANSPORT_STOP_IDS[buildingId];
}

/** Data-driven mapping from transport stop kind to focus ViewMode. */
export const TRANSPORT_FOCUS_MODES: Record<TransportStopKind, ViewMode> = {
  metro: ViewMode.UNDERGROUND,
  rail: ViewMode.RAIL_FOCUS,
  ferry: ViewMode.FERRY_FOCUS,
  bus: ViewMode.BUS_FOCUS,
} as const;

/** Get the focus ViewMode for a given transport stop type. */
export function getTransportFocusMode(type: TransportStopKind): ViewMode {
  return TRANSPORT_FOCUS_MODES[type];
}

/** Transport stop display names. */
export const STOP_NAMES: Record<TransportStopKind, string> = {
  bus: 'Bus Stop', metro: 'Metro Station',
  rail: 'Train Station', ferry: 'Ferry Dock',
};

/**
 * Data-driven vehicle visibility per ViewMode.
 * null = all vehicles visible; Set = only listed types visible (empty = none).
 */
export const VISIBLE_VEHICLE_TYPES: Record<ViewMode, ReadonlySet<string> | null> = {
  [ViewMode.NORMAL]: null,
  [ViewMode.UNDERGROUND]: new Set<string>(),
  [ViewMode.RAIL_FOCUS]: new Set(['rail_train', 'rail_carriage']),
  [ViewMode.FERRY_FOCUS]: new Set(['ferry']),
  [ViewMode.BUS_FOCUS]: new Set(['bus', 'transport_bus']),
  [ViewMode.TRANSFER_FOCUS]: new Set<string>(),
};

/** Determine whether a vehicle type is visible in a given ViewMode. */
export function getVehicleVisibility(mode: ViewMode, vehicleType: string): boolean {
  const allowed = VISIBLE_VEHICLE_TYPES[mode];
  if (allowed === null) return true;
  return allowed.has(vehicleType);
}

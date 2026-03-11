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
  /** 計程車聚焦（道路/計程車全彩，其餘白模） */
  TAXI_FOCUS = 'TAXI_FOCUS',
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
  [ViewMode.TAXI_FOCUS]: { ...ROAD_TRANSPORT_OPACITY },
};

/** 地下模式隧道 Y 位置（負值 = 地面以下） */
export const UNDERGROUND_TUNNEL_Y = -0.15;

/**
 * 判斷車輛是否為地面車輛。
 * Metro trains are now rendered by MetroTunnelRenderer, so all VehicleRenderer types are surface.
 */
export function isSurfaceVehicle(_type: string): boolean {
  return true;
}

// ── Transport stop identification ──

export type TransportStopKind = 'bus' | 'metro' | 'rail' | 'ferry' | 'taxi';

/** buildingId → transport stop type mapping */
export const TRANSPORT_STOP_IDS: Record<number, TransportStopKind> = {
  242: 'bus',
  241: 'metro',
  239: 'rail',
  238: 'ferry',
  236: 'taxi',
};

/** Get transport stop type from buildingId, or undefined if not a transport stop. */
export function getTransportStopType(buildingId: number): TransportStopKind | undefined {
  return TRANSPORT_STOP_IDS[buildingId];
}

/** Get the focus ViewMode for a given transport stop type. */
export function getTransportFocusMode(type: TransportStopKind): ViewMode {
  switch (type) {
    case 'metro': return ViewMode.UNDERGROUND;
    case 'rail': return ViewMode.RAIL_FOCUS;
    case 'ferry': return ViewMode.FERRY_FOCUS;
    case 'bus': return ViewMode.BUS_FOCUS;
    case 'taxi': return ViewMode.TAXI_FOCUS;
  }
}

/** Determine whether a vehicle type is visible in a given ViewMode. */
export function getVehicleVisibility(mode: ViewMode, vehicleType: string): boolean {
  switch (mode) {
    case ViewMode.NORMAL:
      return true;
    case ViewMode.UNDERGROUND:
      return false;
    case ViewMode.RAIL_FOCUS:
      return vehicleType === 'rail_train' || vehicleType === 'rail_carriage';
    case ViewMode.FERRY_FOCUS:
      return vehicleType === 'ferry';
    case ViewMode.BUS_FOCUS:
      return vehicleType === 'bus' || vehicleType === 'transport_bus';
    case ViewMode.TAXI_FOCUS:
      return vehicleType === 'taxi';
  }
}

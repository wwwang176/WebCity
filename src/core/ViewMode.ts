/**
 * ViewMode — 控制遊戲視角模式，影響各 renderer 的透明度與可見性。
 */
export enum ViewMode {
  /** 正常地面視角 */
  NORMAL = 'NORMAL',
  /** 地下模式（地鐵隧道可見，地面物體半透明） */
  UNDERGROUND = 'UNDERGROUND',
}

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
}> = {
  [ViewMode.NORMAL]: {
    building: 1.0,
    road: 1.0,
    terrain: 1.0,
    surfaceVehicle: 1.0,
    metroTunnel: 0.0,
    metroTrain: 0.0,
  },
  [ViewMode.UNDERGROUND]: {
    building: 0.12,
    road: 0.15,
    terrain: 0.2,
    surfaceVehicle: 0.08,
    metroTunnel: 1.0,
    metroTrain: 1.0,
  },
};

/** 地下模式隧道 Y 位置（負值 = 地面以下） */
export const UNDERGROUND_TUNNEL_Y = -0.15;

/**
 * 判斷車輛是否為地面車輛（地下模式時需要半透明化的類型）。
 */
export function isSurfaceVehicle(type: string): boolean {
  return type !== 'metro_train';
}

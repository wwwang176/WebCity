export enum TransportType {
  BUS = 'BUS',
  METRO = 'METRO',
  RAIL = 'RAIL',
  FERRY = 'FERRY',
  AIRPORT = 'AIRPORT',
}

export enum TransportMode {
  WALK = 'WALK',
  DRIVE = 'DRIVE',
  BUS = 'BUS',
  METRO = 'METRO',
  RAIL = 'RAIL',
  FERRY = 'FERRY',
}

export interface TransportStop {
  id: number;
  x: number;
  y: number;
  type: TransportType;
  passengers: number;
  /** Today's accumulated rider count (internal, reset daily). */
  dailyRiders: number;
  /** Yesterday's complete rider count. */
  lastDayRiders: number;
  /** EMA-smoothed daily riders for stable UI display. */
  smoothedDailyRiders: number;
  /** Adjacent road cell X (bus only — used for lane pathfinding). */
  roadX?: number;
  /** Adjacent road cell Y (bus only — used for lane pathfinding). */
  roadY?: number;
}

export interface TransportRoute {
  id: number;
  type: TransportType;
  stops: TransportStop[];
  vehicles: number;
  operatingCost: number;
  // 班距不是欄位。它是「整圈時間 ÷ 車輛數」，由 RouteLoad.computeHeadway 在使用處
  // 算出來 —— 存成欄位的話每個動到路線的地方都得記得重算，而加車那條路就漏了：
  // 加車只把容量上限往上推，等車一秒都沒有變短。
  /** True if the route is suspended due to road disconnection. */
  suspended?: boolean;
}

export interface TransportVehicle {
  id: number;
  routeId: number;
  currentStopIndex: number;
  passengers: number;
  capacity: number;
  position: { x: number; y: number };
  /** Ticks remaining at the current stop (used for dwell time). */
  waitTicks: number;
  /** True while the vehicle is dwelling at a stop. */
  atStop: boolean;
  /** Ticks remaining to travel between stops. */
  travelTicks: number;
  /** True while the vehicle is traveling between stops. */
  traveling: boolean;
}

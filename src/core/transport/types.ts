export enum TransportType {
  BUS = 'BUS',
  METRO = 'METRO',
  TRAM = 'TRAM',
  RAIL = 'RAIL',
  FERRY = 'FERRY',
  AIRPORT = 'AIRPORT',
  TAXI = 'TAXI',
}

export enum TransportMode {
  WALK = 'WALK',
  DRIVE = 'DRIVE',
  BUS = 'BUS',
  METRO = 'METRO',
  TRAM = 'TRAM',
  RAIL = 'RAIL',
  FERRY = 'FERRY',
}

export interface TransportStop {
  id: number;
  x: number;
  y: number;
  type: TransportType;
  passengers: number;
}

export interface TransportRoute {
  id: number;
  type: TransportType;
  stops: TransportStop[];
  vehicles: number;
  frequency: number;
  operatingCost: number;
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
}

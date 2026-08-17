import * as THREE from 'three';
import { ROAD_SURFACE_Y, RAIL_SURFACE_Y } from './surfaceHeights';
import {
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildPoliceCarGeometry,
  buildAmbulanceGeometry,
  buildGarbageTruckGeometry,
  buildVanGeometry,
  buildTransportBusGeometry,
  buildRailTrainGeometry,
  buildRailCarriageGeometry,
  buildFerryGeometry,
  buildAirplaneGeometry,
} from './geometry';

export interface VehicleTypeConfig {
  color: number;         // -1 means per-instance (e.g. car)
  frontOffset: number;
  rearOffset: number;
  yPosition: number;
  buildGeometry: () => THREE.BufferGeometry;
}

export const VEHICLE_CONFIG: Record<string, VehicleTypeConfig> = {
  car:            { color: -1,       frontOffset: 0.12, rearOffset: 0.12, yPosition: ROAD_SURFACE_Y, buildGeometry: buildCarGeometry },
  bus:            { color: 0xff9800, frontOffset: 0.30, rearOffset: 0.30, yPosition: ROAD_SURFACE_Y, buildGeometry: buildBusGeometry },
  van:            { color: -1,       frontOffset: 0.135, rearOffset: 0.135, yPosition: ROAD_SURFACE_Y, buildGeometry: buildVanGeometry },
  truck:          { color: -1,       frontOffset: 0.225, rearOffset: 0.225, yPosition: ROAD_SURFACE_Y, buildGeometry: buildTruckGeometry },
  firetruck:      { color: 0xb71c1c, frontOffset: 0.275, rearOffset: 0.275, yPosition: ROAD_SURFACE_Y, buildGeometry: buildFiretruckGeometry },
  police_car:     { color: 0x1a237e, frontOffset: 0.12, rearOffset: 0.12, yPosition: ROAD_SURFACE_Y, buildGeometry: buildPoliceCarGeometry },
  ambulance:      { color: 0xffffff, frontOffset: 0.15, rearOffset: 0.15, yPosition: ROAD_SURFACE_Y, buildGeometry: buildAmbulanceGeometry },
  garbage_truck:  { color: 0x2e7d32, frontOffset: 0.225, rearOffset: 0.225, yPosition: ROAD_SURFACE_Y, buildGeometry: buildGarbageTruckGeometry },
  transport_bus:  { color: 0xff9800, frontOffset: 0.30, rearOffset: 0.30, yPosition: ROAD_SURFACE_Y, buildGeometry: buildTransportBusGeometry },
  rail_train:     { color: 0xff5722, frontOffset: 0.11, rearOffset: 0.11, yPosition: RAIL_SURFACE_Y, buildGeometry: buildRailTrainGeometry },
  rail_carriage:  { color: 0xff5722, frontOffset: 0.125, rearOffset: 0.125, yPosition: RAIL_SURFACE_Y, buildGeometry: buildRailCarriageGeometry },
  ferry:          { color: 0x0097a7, frontOffset: 0.42, rearOffset: 0.32, yPosition: -0.06,  buildGeometry: buildFerryGeometry },
  airplane:       { color: -1,       frontOffset: 0.45, rearOffset: 0.45, yPosition: 0.09,  buildGeometry: buildAirplaneGeometry },
};

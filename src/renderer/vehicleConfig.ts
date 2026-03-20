import * as THREE from 'three';
import {
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildPoliceCarGeometry,
  buildAmbulanceGeometry,
  buildGarbageTruckGeometry,
  buildTransportBusGeometry,
  buildRailTrainGeometry,
  buildRailCarriageGeometry,
  buildFerryGeometry,
} from './geometry';

export interface VehicleTypeConfig {
  color: number;         // -1 means per-instance (e.g. car)
  frontOffset: number;
  rearOffset: number;
  yPosition: number;
  buildGeometry: () => THREE.BufferGeometry;
}

export const VEHICLE_CONFIG: Record<string, VehicleTypeConfig> = {
  car:            { color: -1,       frontOffset: 0.12, rearOffset: 0.12, yPosition: 0.025, buildGeometry: buildCarGeometry },
  bus:            { color: 0xff9800, frontOffset: 0.30, rearOffset: 0.30, yPosition: 0.025, buildGeometry: buildBusGeometry },
  truck:          { color: 0x78909c, frontOffset: 0.225, rearOffset: 0.225, yPosition: 0.025, buildGeometry: buildTruckGeometry },
  firetruck:      { color: 0xd32f2f, frontOffset: 0.275, rearOffset: 0.275, yPosition: 0.025, buildGeometry: buildFiretruckGeometry },
  police_car:     { color: 0x1a237e, frontOffset: 0.12, rearOffset: 0.12, yPosition: 0.025, buildGeometry: buildPoliceCarGeometry },
  ambulance:      { color: 0xffffff, frontOffset: 0.15, rearOffset: 0.15, yPosition: 0.025, buildGeometry: buildAmbulanceGeometry },
  garbage_truck:  { color: 0x2e7d32, frontOffset: 0.225, rearOffset: 0.225, yPosition: 0.025, buildGeometry: buildGarbageTruckGeometry },
  transport_bus:  { color: 0xff9800, frontOffset: 0.30, rearOffset: 0.30, yPosition: 0.025, buildGeometry: buildTransportBusGeometry },
  rail_train:     { color: 0xff5722, frontOffset: 0.11, rearOffset: 0.11, yPosition: 0.025, buildGeometry: buildRailTrainGeometry },
  rail_carriage:  { color: 0xff5722, frontOffset: 0.125, rearOffset: 0.125, yPosition: 0.025, buildGeometry: buildRailCarriageGeometry },
  ferry:          { color: 0x0097a7, frontOffset: 0.42, rearOffset: 0.32, yPosition: -0.06,  buildGeometry: buildFerryGeometry },
};

import * as THREE from 'three';
import {
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildTransportBusGeometry,
  buildTramGeometry,
  buildRailTrainGeometry,
  buildFerryGeometry,
  buildTaxiGeometry,
} from './vehicleGeometry';

export interface VehicleTypeConfig {
  color: number;         // -1 means per-instance (e.g. car)
  frontOffset: number;
  rearOffset: number;
  yPosition: number;
  buildGeometry: () => THREE.BufferGeometry;
}

export const VEHICLE_CONFIG: Record<string, VehicleTypeConfig> = {
  car:            { color: -1,       frontOffset: 0.12, rearOffset: 0.12, yPosition: 0.025, buildGeometry: buildCarGeometry },
  bus:            { color: 0xff9800, frontOffset: 0.23, rearOffset: 0.23, yPosition: 0.025, buildGeometry: buildBusGeometry },
  truck:          { color: 0x78909c, frontOffset: 0.16, rearOffset: 0.16, yPosition: 0.025, buildGeometry: buildTruckGeometry },
  firetruck:      { color: 0xd32f2f, frontOffset: 0.18, rearOffset: 0.14, yPosition: 0.025, buildGeometry: buildFiretruckGeometry },
  transport_bus:  { color: 0xff9800, frontOffset: 0.23, rearOffset: 0.23, yPosition: 0.025, buildGeometry: buildTransportBusGeometry },
  tram:           { color: 0x8bc34a, frontOffset: 0.2,  rearOffset: 0.2,  yPosition: 0.025, buildGeometry: buildTramGeometry },
  rail_train:     { color: 0xff5722, frontOffset: 0.33, rearOffset: 0.24, yPosition: 0.025, buildGeometry: buildRailTrainGeometry },
  ferry:          { color: 0x0097a7, frontOffset: 0.26, rearOffset: 0.2,  yPosition: 0.025, buildGeometry: buildFerryGeometry },
  taxi:           { color: 0xfdd835, frontOffset: 0.12, rearOffset: 0.12, yPosition: 0.025, buildGeometry: buildTaxiGeometry },
};

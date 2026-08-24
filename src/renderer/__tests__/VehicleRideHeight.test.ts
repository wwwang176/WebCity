import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_CONFIG } from '../vehicleConfig';
import {
  ROAD_Y, ROAD_SLAB_THICKNESS, ROAD_SURFACE_Y, RAIL_Y, RAIL_THICKNESS, RAIL_SURFACE_Y,
} from '../surfaceHeights';

/**
 * Wheels rest **on top of** the asphalt.
 *
 * A road surface is a centred `BoxGeometry(1, 0.05, 1)` at y=0.025, so the slab spans 0 to 0.05 and
 * the surface the player sees is **0.05**. Placing vehicles at 0.025, the slab's mid-line, sinks
 * every one of them 0.025 into the asphalt — and with wheels 0.023 tall, buries them completely.
 *
 * Nothing reports this on screen; it only looks wrong, so a test pins the two sides together.
 */

/** Vehicles that travel on roads. Vessels and aircraft are excluded: their height comes from the water surface and the flight altitude. */
const ROAD_VEHICLES: string[] = [
  'car', 'bus', 'van', 'truck', 'firetruck', 'police_car', 'ambulance',
  'garbage_truck', 'transport_bus',
];

/** A geometry's lowest point, which is the bottom of the wheels relative to the vehicle's origin. */
function lowestPoint(build: () => THREE.BufferGeometry): number {
  const geo = build();
  geo.computeBoundingBox();
  const y = geo.boundingBox!.min.y;
  geo.dispose();
  return y;
}

describe('路面高度', () => {
  it('should put the surface on top of the slab, not through the middle of it', () => {
    expect(ROAD_SURFACE_Y).toBeCloseTo(ROAD_Y + ROAD_SLAB_THICKNESS / 2, 9);
    expect(ROAD_SURFACE_Y).toBeGreaterThan(ROAD_Y);
  });
});

describe('車輪踩在柏油上', () => {
  it.each(ROAD_VEHICLES)('should land %s on the road surface, not inside it', (type) => {
    const cfg = VEHICLE_CONFIG[type]!;
    const wheelBottom = cfg.yPosition + lowestPoint(cfg.buildGeometry);
    // Every wheel bottom measures within +-0.0005 of the road surface, so the threshold is 0.001; at
    // 0.01 it would not even catch the rail height being used by mistake, a difference of 0.0075.
    expect(Math.abs(wheelBottom - ROAD_SURFACE_Y), `${type} 的輪底在 ${wheelBottom.toFixed(4)}，路面在 ${ROAD_SURFACE_Y}`)
      .toBeLessThan(0.002);
  });

  it('should not leave the old mid-slab height in the config', () => {
    // The old value; still present, it means someone changed only half of this.
    for (const type of ROAD_VEHICLES) {
      expect(VEHICLE_CONFIG[type]!.yPosition, type).not.toBe(ROAD_Y);
    }
  });
});

describe('火車輪踩在軌頂上', () => {
  it('should put the rail head on top of the rail, not through it', () => {
    expect(RAIL_SURFACE_Y).toBeCloseTo(RAIL_Y + RAIL_THICKNESS / 2, 9);
  });

  it('should not ride the trains at road height', () => {
    // Rails sit on ballast at a different height from asphalt; one number for both makes one of them
    // wrong.
    expect(RAIL_SURFACE_Y).not.toBeCloseTo(ROAD_SURFACE_Y, 6);
  });

  it.each(['rail_train', 'rail_carriage'])('should land %s on the rail head', (type) => {
    const cfg = VEHICLE_CONFIG[type]!;
    const wheelBottom = cfg.yPosition + lowestPoint(cfg.buildGeometry);
    expect(Math.abs(wheelBottom - RAIL_SURFACE_Y), `${type} 的輪底在 ${wheelBottom.toFixed(4)}，軌頂在 ${RAIL_SURFACE_Y}`)
      .toBeLessThan(0.002);
  });
});

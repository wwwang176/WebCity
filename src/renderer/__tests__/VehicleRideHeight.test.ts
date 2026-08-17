import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_CONFIG } from '../vehicleConfig';
import {
  ROAD_Y, ROAD_SLAB_THICKNESS, ROAD_SURFACE_Y, RAIL_Y, RAIL_THICKNESS, RAIL_SURFACE_Y,
} from '../surfaceHeights';

/**
 * 車輪要踩在柏油**上面**。
 *
 * 路面是一塊置中的 `BoxGeometry(1, 0.05, 1)` 擺在 y=0.025 —— 所以板子佔 0 到 0.05，
 * 而玩家看到的路面是 **0.05**。車輛卻擺在 0.025，也就是板子的中線，於是每一台車都
 * 陷進柏油裡 0.025:輪子高 0.023，整個埋掉。
 *
 * 這件事在畫面上不會報錯，只會看起來怪，所以要有一條測試把兩邊釘在一起。
 */

/** 走在路上的車。船與飛機不算 —— 它們的高度由水面與飛行高度決定。 */
const ROAD_VEHICLES: string[] = [
  'car', 'bus', 'van', 'truck', 'firetruck', 'police_car', 'ambulance',
  'garbage_truck', 'transport_bus',
];

/** 這個幾何最低的一點在哪 —— 也就是車輪底部相對於車輛原點的位置。 */
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
    // 實測每一台的輪底都落在路面 ±0.0005 之內，所以門檻收到 0.001 ——
    // 寬到 0.01 的話連「用成軌道高度」（差 0.0075）都測不出來。
    expect(Math.abs(wheelBottom - ROAD_SURFACE_Y), `${type} 的輪底在 ${wheelBottom.toFixed(4)}，路面在 ${ROAD_SURFACE_Y}`)
      .toBeLessThan(0.002);
  });

  it('should not leave the old mid-slab height in the config', () => {
    // 這是原本的值。留著就代表有人只改了一半。
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
    // 軌道鋪在道碴上，跟柏油本來就不同高。共用一個數字的話一定有一邊是錯的。
    expect(RAIL_SURFACE_Y).not.toBeCloseTo(ROAD_SURFACE_Y, 6);
  });

  it.each(['rail_train', 'rail_carriage'])('should land %s on the rail head', (type) => {
    const cfg = VEHICLE_CONFIG[type]!;
    const wheelBottom = cfg.yPosition + lowestPoint(cfg.buildGeometry);
    expect(Math.abs(wheelBottom - RAIL_SURFACE_Y), `${type} 的輪底在 ${wheelBottom.toFixed(4)}，軌頂在 ${RAIL_SURFACE_Y}`)
      .toBeLessThan(0.002);
  });
});

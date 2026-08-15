import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TransportRouteRenderer } from '../TransportRouteRenderer';
import type { TransportRouteRenderData } from '../../core/transport/collectTransportRoutes';

/**
 * 路線連線畫成拋物線。弧的數學在 `core/transport/RouteArc`（有自己那一組測試），
 * 這裡只釘住渲染端**真的用了它** —— 幾何仍然照站點兩兩直連的話，弧算得再好也
 * 沒有畫出來。
 */

function route(stops: { x: number; y: number }[]): TransportRouteRenderData {
  return { routeId: 1, system: 'BUS', color: 0xff0000, stops };
}

function firstLineGeometry(renderer: TransportRouteRenderer): THREE.BufferGeometry {
  const lines = (renderer as unknown as { lines: THREE.Line[] }).lines;
  const line = lines[0];
  if (!line) throw new Error('一條線都沒畫，這組情境等於沒測');
  return line.geometry;
}

function makeRenderer(stops: { x: number; y: number }[]) {
  const renderer = new TransportRouteRenderer();
  renderer.build(new THREE.Scene());
  renderer.update([route(stops)]);
  return renderer;
}

describe('路線連線的幾何', () => {
  const STOPS = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }];

  it('should sample the hops instead of joining the stops directly', () => {
    const geo = firstLineGeometry(makeRenderer(STOPS));
    // 直連是 4 個點（三站 + 繞回第一站）。取樣過的弧遠不止。
    expect(geo.getAttribute('position').count, '連線還是站點兩兩直連').toBeGreaterThan(8);
  });

  it('should lift the middle of each hop off the ground', () => {
    const pos = firstLineGeometry(makeRenderer(STOPS)).getAttribute('position');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      min = Math.min(min, pos.getY(i));
      max = Math.max(max, pos.getY(i));
    }
    expect(max - min, '整條線都在同一個高度，沒有拱起來').toBeGreaterThan(0.1);
  });

  it('should keep the line at ground height where it meets a stop', () => {
    // 弧要接得到站牌。整條線一起抬高的話，線會浮在城市上方與站點脫節。
    const pos = firstLineGeometry(makeRenderer(STOPS)).getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
    expect(lowest).toBeCloseTo(0.15, 6);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TransportRouteRenderer } from '../TransportRouteRenderer';
import type { TransportRouteRenderData } from '../../core/transport/collectTransportRoutes';

/**
 * Route lines are drawn as parabolas. The arc arithmetic lives in `core/transport/RouteArc` with its
 * own tests; these cases pin that the renderer **actually uses it** — with the geometry still
 * joining stops in straight pairs, however well the arc computes, none of it is drawn.
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
    // Straight joins give 4 points: three stops plus the wrap back to the first. A sampled arc gives
    // far more.
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
    // The arcs have to meet the stops; lifting the whole line leaves it floating above the city,
    // detached from them.
    const pos = firstLineGeometry(makeRenderer(STOPS)).getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
    expect(lowest).toBeCloseTo(0.15, 6);
  });
});

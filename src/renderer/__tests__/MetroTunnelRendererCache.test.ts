import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MetroTunnelRenderer, type MetroLineData } from '../MetroTunnelRenderer';
import { computeTunnelSegments } from '../../core/transport/MetroTunnelPath';
import { TransportType, type TransportStop } from '../../core/transport/types';

/**
 * Segments come from the same function Game.ts calls. The hand-rolled version
 * this replaces emitted `{ start, end }` against a TunnelSegment of
 * `{ from, to }`, so every segment the renderer read was `{ from: undefined,
 * to: undefined }` — it was caching geometry built from nothing.
 */
function makeLineData(lineId: number, stops: { x: number; y: number }[], trainCount = 1): MetroLineData {
  return { lineId, stops, segments: computeTunnelSegments(stops), trainCount };
}

/** Metro stations as the renderer receives them. */
function makeStations(points: { x: number; y: number }[]): TransportStop[] {
  return points.map((p, i) => ({
    id: i + 1, x: p.x, y: p.y, type: TransportType.METRO,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  }));
}

/** Collect UUIDs of all meshes in the tunnelGroup (excluding carriageMesh). */
function collectMeshUUIDs(renderer: MetroTunnelRenderer): string[] {
  // Access tunnelGroup via getMeshCount hack: iterate scene children
  // Since we can't access private, use a workaround:
  // Build into a scene, get children of the group added to the scene
  return [];
}

describe('MetroTunnelRenderer caching', () => {
  it('does not rebuild tunnel geometry when topology is unchanged', () => {
    const renderer = new MetroTunnelRenderer();
    const scene = new THREE.Scene();
    renderer.build(scene);

    const line = makeLineData(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
    const stations = makeStations([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);

    // First update — build tunnels
    renderer.update([line], stations, 0.6, 0.016);
    const meshCount1 = renderer.getMeshCount();
    expect(meshCount1).toBeGreaterThan(0);

    // Capture UUIDs of mesh children
    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const uuids1 = group.children.filter(c => c instanceof THREE.Mesh).map(c => c.uuid);

    // Second update with same topology — should reuse cached meshes
    renderer.update([line], stations, 0.6, 0.016);
    const meshCount2 = renderer.getMeshCount();
    expect(meshCount2).toBe(meshCount1);

    const uuids2 = group.children.filter(c => c instanceof THREE.Mesh).map(c => c.uuid);
    expect(uuids2).toEqual(uuids1); // same objects, not rebuilt

    renderer.dispose();
  });

  it('updates opacity without rebuilding geometry', () => {
    const renderer = new MetroTunnelRenderer();
    const scene = new THREE.Scene();
    renderer.build(scene);

    const line = makeLineData(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    const stations = makeStations([{ x: 0, y: 0 }, { x: 5, y: 0 }]);

    renderer.update([line], stations, 0.6, 0.016);

    const group = scene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const uuidsBefore = group.children.filter(c => c instanceof THREE.Mesh).map(c => c.uuid);

    // Change only opacity
    renderer.update([line], stations, 0.3, 0.016);

    const uuidsAfter = group.children.filter(c => c instanceof THREE.Mesh).map(c => c.uuid);
    expect(uuidsAfter).toEqual(uuidsBefore); // same objects

    // Opacity should be updated on materials
    for (const child of group.children) {
      if (child instanceof THREE.Mesh && child !== (renderer as any).carriageMesh) {
        const mat = child.material as THREE.MeshBasicMaterial;
        expect(mat.opacity).toBeLessThan(0.6); // Should reflect new opacity
      }
    }

    renderer.dispose();
  });

  it('rebuilds when topology changes (new station added)', () => {
    const renderer = new MetroTunnelRenderer();
    const scene = new THREE.Scene();
    renderer.build(scene);

    const line1 = makeLineData(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    const stations1 = makeStations([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    renderer.update([line1], stations1, 0.6, 0.016);
    const count1 = renderer.getMeshCount();

    // Add station — topology changes
    const line2 = makeLineData(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
    const stations2 = makeStations([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
    renderer.update([line2], stations2, 0.6, 0.016);
    const count2 = renderer.getMeshCount();

    expect(count2).toBeGreaterThan(count1);
    renderer.dispose();
  });

  it('hides group when opacity is 0 without disposing meshes', () => {
    const renderer = new MetroTunnelRenderer();
    const scene = new THREE.Scene();
    renderer.build(scene);

    const line = makeLineData(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    const stations = makeStations([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    renderer.update([line], stations, 0.6, 0.016);
    const count = renderer.getMeshCount();
    expect(count).toBeGreaterThan(0);

    // Opacity 0 — hide but keep meshes cached
    renderer.update([line], stations, 0, 0.016);
    expect(renderer.getMeshCount()).toBe(count);

    renderer.dispose();
  });
});

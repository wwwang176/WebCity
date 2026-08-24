import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ElevatedRoadRenderer } from '../ElevatedRoadRenderer';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { Grid } from '../../core/grid/Grid';
import { RoadType, RoadDirection } from '../../core/road/types';

/**
 * An elevated street lamp's glow is a half circle.
 *
 * The lamp stands at the deck's edge, where half of a full ring falls into open air beyond the
 * bridge and reads as yellow haze floating in mid-air. Ground lamps are unaffected: they have ground
 * all around them.
 */

function elevatedScene(): THREE.Scene {
  const grid = new Grid(8, 8);
  const em = new ElevationManager();
  for (let y = 2; y <= 5; y++) {
    em.set(4, y, 1, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
      railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0,
    });
  }
  const scene = new THREE.Scene();
  new ElevatedRoadRenderer().build(scene, grid, em);
  return scene;
}

/** Finds the glow mesh: the only disc with a vertex-colour gradient. */
function glowGeometry(scene: THREE.Scene): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    const g = o.geometry;
    if (g.getAttribute('color') && g.getAttribute('position').count < 40) found = g;
  });
  expect(found, '找不到光暈，這支測試等於沒測').not.toBeNull();
  return found!;
}

describe('高架路燈的光暈', () => {
  it('should only cover half the disc', () => {
    // A full circle spreads its vertices all the way around the centre; a half circle keeps them on
    // one side.
    const pos = glowGeometry(elevatedScene()).getAttribute('position');
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
    }
    // The half circle rests on the straight edge at z=0 and extends to one side only.
    expect(Math.min(Math.abs(minZ), Math.abs(maxZ))).toBeLessThan(1e-6);
    expect(Math.max(Math.abs(minZ), Math.abs(maxZ))).toBeGreaterThan(0.3);
  });

  it('should still fade out from the lamp', () => {
    // The vertex colours are a gradient, bright at the centre and dark at the rim; halving must not
    // lose it.
    const geo = glowGeometry(elevatedScene());
    const color = geo.getAttribute('color');
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < color.count; i++) {
      min = Math.min(min, color.getX(i));
      max = Math.max(max, color.getX(i));
    }
    expect(max - min).toBeGreaterThan(0.5);
  });
});

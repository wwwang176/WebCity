import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GROUND_LAYERS } from '../geometry/buildings/propBands';
import { DECAL_Y, MARK_Y } from '../geometry/buildings/decals';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { INFRA_CONFIGS } from '../../core/building/InfraConfig';

interface Internals {
  zoneLayer: InstancedLayer;
  propLayer: InstancedLayer;
}

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

function baseY(layer: InstancedLayer, x: number, y: number): number {
  const entry = layer.entryFor(`${x},${y}`)!;
  const mesh = layer.meshFor(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(m).min.y;
}

/**
 * BUG-224: zoned buildings sat at y = 0.05, the height of the **road surface** (ROAD_Y 0.025 plus
 * half the 0.05 slab thickness), not of the ground. The terrain surface is y = 0, so every building
 * floated 0.6 m: the shadow fell on the ground while the building began 0.6 m up, and under a low
 * sun the two parted company.
 *
 * Infrastructure buildings use y = 0, and that inconsistency is itself the evidence it was a slip.
 */
describe('GROUND_LAYERS', () => {
  it('should keep everything that sits on the ground within a few centimetres of it', () => {
    for (const [name, y] of Object.entries(GROUND_LAYERS)) {
      expect(y * METRES_PER_CELL, `${name} 離地 ${(y * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
      expect(y, `${name} 陷進地面`).toBeGreaterThan(0);
    }
  });

  it('should stack markings above paving', () => {
    // Markings sit above the paving, or they z-fight.
    expect(GROUND_LAYERS.MARKING).toBeGreaterThan(GROUND_LAYERS.DECAL);
  });

  it('should be the only source of these heights', () => {
    expect(DECAL_Y).toBe(GROUND_LAYERS.DECAL);
    expect(MARK_Y).toBe(GROUND_LAYERS.MARKING);
  });
});

describe('buildings stand on the ground', () => {
  it('should put the bottom of every zone building within centimetres of the terrain', () => {
    const { renderer, internals } = fresh();
    const cases: Array<[number, number, 'LOW' | 'HIGH']> = [
      [ZoneType.RESIDENTIAL_LOW, 1, 'LOW'],
      [ZoneType.RESIDENTIAL_HIGH, 3, 'HIGH'],
      [ZoneType.COMMERCIAL_LOW, 2, 'LOW'],
      [ZoneType.INDUSTRIAL, 3, 'LOW'],
      [ZoneType.OFFICE, 3, 'HIGH'],
    ];
    cases.forEach(([zone, level, density], i) => {
      renderer.addBuilding(i, 0, zone, density, level, false);
      const y = baseY(internals.zoneLayer, i, 0);
      expect(y * METRES_PER_CELL, `zone ${zone} 浮空 ${(y * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
    });
  });

  it('should put ground props on the ground too', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_LOW, 'LOW', 3, false);
    const y = baseY(internals.propLayer, 0, 0);
    expect(y * METRES_PER_CELL, `地面物件浮空 ${(y * METRES_PER_CELL).toFixed(2)} m`)
      .toBeLessThan(0.1);
  });

  it('should stand every public facility on the ground too', () => {
    // All nineteen kinds are checked, the ferry terminal included. It was once the only kind
    // reaching into water, back when it drew its own basin inside its footprint.
    // `isShorePosition` means the cell is land with water in one of its four neighbours: the
    // terminal stands on land and the water is the cell next door.
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    let i = 0;
    for (const cfg of INFRA_CONFIGS) {
      renderer.addInfrastructure(scene, i * 12, 0, cfg.type, 0);
      i++;
    }
    for (const group of scene.children) {
      if (!(group instanceof THREE.Group)) continue;
      const minY = new THREE.Box3().setFromObject(group).min.y;
      expect(minY * METRES_PER_CELL, `設施浮空 ${(minY * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThan(0.1);
      expect(minY * METRES_PER_CELL, `設施陷入 ${(-minY * METRES_PER_CELL).toFixed(2)} m`)
        .toBeGreaterThan(-0.1);
    }
  });

  it('should stand the ferry dock on the land it is actually built on', () => {
    // The terminal sits on the ground like every other kind, with no exception in `snapToGround`
    // for reaching below the water surface at -0.2: `isShorePosition` requires the terminal's cell
    // to **be land** (BUG-244).
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.addInfrastructure(scene, 0, 0, 'ferry_dock', 0);
    const group = scene.children.find(c => c instanceof THREE.Group)!;
    const minY = new THREE.Box3().setFromObject(group).min.y;
    expect(minY, '碼頭陷到地面以下 —— 這一格是陸地').toBeGreaterThanOrEqual(0);
    expect(minY * METRES_PER_CELL, '碼頭浮空').toBeLessThan(0.1);
  });

  it('should not leave a step between a building and its own forecourt', () => {
    // A forecourt's paving out of line with the wall's foot makes the floating more obvious, not
    // less.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 3, false);
    const building = baseY(internals.zoneLayer, 0, 0);
    expect(Math.abs(building - GROUND_LAYERS.DECAL) * METRES_PER_CELL,
      '建築底面與鋪面高度差').toBeLessThan(0.05);
  });
});

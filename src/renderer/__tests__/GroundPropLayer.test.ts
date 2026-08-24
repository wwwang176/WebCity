import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { GROUND_LAYERS } from '../geometry/buildings/propBands';

const ZONE = ZoneType.RESIDENTIAL_LOW;

type Internals = Record<LayerName, InstancedLayer> & { zoneLayer: InstancedLayer };

/** The three layers attached to a building. One set of invariants holds for all three, so the tests run per layer. */
const ATTACHMENT_LAYERS = ['decalLayer', 'propLayer', 'overheadLayer'] as const;
type AnyLayer = LayerName | 'zoneLayer';
type LayerName = (typeof ATTACHMENT_LAYERS)[number];

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

/** One layer's instance matrix for this cell. */
function layerMatrix(
  internals: Internals, layer: AnyLayer, x: number, y: number,
): THREE.Matrix4 {
  const entry = internals[layer].entryFor(`${x},${y}`)!;
  const mesh = internals[layer].meshFor(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  return m;
}

/** One layer's world-space bounding box for this cell. */
function layerBox(
  internals: Internals, layer: AnyLayer, x: number, y: number,
): THREE.Box3 {
  const entry = internals[layer].entryFor(`${x},${y}`)!;
  const mesh = internals[layer].meshFor(entry.key)!;
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(layerMatrix(internals, layer, x, y));
}

const propMatrix = (i: Internals, x: number, y: number) => layerMatrix(i, 'propLayer', x, y);
const propBox = (i: Internals, x: number, y: number) => layerBox(i, 'propLayer', x, y);

describe('ground prop layer', () => {
  it('should never scale a garden, at any level', () => {
    // BUG-219: level scaling multiplies a Y scale over the whole merged geometry, so upgrading
    // low-density residential from L1 to L3 stretches the yard's tree by 1.75x, from 1.44 to
    // 2.52 m. A tree does not grow because the house gained a storey.
    //
    // The assertion is that the matrix carries no scale, not that yards at different levels are the
    // same height — the latter is false, since the yard recipe changes with level, from a bare yard
    // to a hedge to a tended garden.
    const scale = new THREE.Vector3();
    for (const level of [1, 2, 3]) {
      for (const [x, y] of [[0, 0], [3, 7], [11, 4]] as const) {
        const { renderer, internals } = fresh();
        renderer.addBuilding(x, y, ZONE, 'LOW', level, false);
        propMatrix(internals, x, y).decompose(
          new THREE.Vector3(), new THREE.Quaternion(), scale,
        );
        expect(scale.x, `L${level} @${x},${y} 寬被縮放`).toBeCloseTo(1, 9);
        expect(scale.y, `L${level} @${x},${y} 高被縮放`).toBeCloseTo(1, 9);
        expect(scale.z, `L${level} @${x},${y} 深被縮放`).toBeCloseTo(1, 9);
      }
    }
  });

  it('should draw the garden at exactly the size it was authored', () => {
    // The case above reads the matrix and this one the drawn result; together they close the
    // workaround of moving the scale into geometry generation. Real sizes: a 4 m tree is 4 m.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 2, false);
    const entry = internals.propLayer.entryFor('0,0')!;
    const mesh = internals.propLayer.meshFor(entry.key)!;
    const authored = new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    const drawn = propBox(internals, 0, 0);
    expect(drawn.max.y - drawn.min.y).toBeCloseTo(authored.max.y - authored.min.y, 9);
  });

  it('should give every low-density house a garden', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    }
    expect(internals.propLayer.size).toBe(36);
  });

  it('should give every zone props, not just residential', () => {
    // With buildings narrowed by 7 to 8% to open a 0.4 m band, plot-filling zones do have props;
    // before that they had none.
    const { renderer, internals } = fresh();
    const cells: Array<[number, number, number, 'LOW' | 'HIGH']> = [
      [0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
      [1, 0, ZoneType.INDUSTRIAL, 'LOW'],
      [2, 0, ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [3, 0, ZoneType.OFFICE, 'HIGH'],
      [4, 0, ZoneType.COMMERCIAL_LOW, 'LOW'],
    ];
    for (const [x, y, zone, density] of cells) {
      renderer.addBuilding(x, y, zone, density, 3, false);
      expect(internals.propLayer.entryFor(`${x},${y}`), `zone ${zone} 沒有物件`).toBeDefined();
    }
  });

  it('should take the garden away with the building', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    renderer.addBuilding(1, 0, ZONE, 'LOW', 1, false);
    renderer.removeBuilding(0, 0);
    expect(internals.propLayer.entryFor('0,0')).toBeUndefined();
    expect(internals.propLayer.entryFor('1,0')).toBeDefined();
  });

  it('should swap the garden when the house upgrades', () => {
    // The yard recipe differs by level, so an upgrade has to change buckets: with only the matrix
    // updated, an L3 house keeps an L1 bare yard.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    const before = internals.propLayer.entryFor('0,0')!.key;
    renderer.updateBuilding(0, 0, ZONE, 'LOW', 3, false);
    expect(internals.propLayer.entryFor('0,0')!.key).not.toBe(before);
  });

  it('should clear every garden when the map is rebuilt', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 4; x++) renderer.addBuilding(x, 0, ZONE, 'LOW', 1, false);
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    expect(internals.propLayer.size).toBe(0);
  });

  it('should keep every remaining garden on its own house after removals', () => {
    // A swap-with-last index bug only surfaces after a removal and does not show on screen. A 20x20
    // city also outgrows the initial capacity, covering the doubling path as well.
    const { renderer, internals } = fresh();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
        cells.push([x, y]);
      }
    }
    for (let i = 0; i < cells.length; i += 3) {
      renderer.removeBuilding(cells[i]![0], cells[i]![1]);
    }
    const pos = new THREE.Vector3();
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 === 0) continue;
      const [x, y] = cells[i]!;
      pos.setFromMatrixPosition(propMatrix(internals, x, y));
      expect(pos.x, `${x},${y} 的院子跑到別人家`).toBeCloseTo(x, 6);
      expect(pos.z, `${x},${y} 的院子跑到別人家`).toBeCloseTo(y, 6);
    }
  });

  it('should not give the whole street the same yard', () => {
    // The yard has a random stream of its own. Shared with the massing, one house type is always
    // paired with one yard, which moves the repetition from the house to the yard.
    const { renderer, internals } = fresh();
    const keys = new Set<string>();
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 3, false);
        keys.add(internals.propLayer.entryFor(`${x},${y}`)!.key);
      }
    }
    expect(keys.size).toBeGreaterThan(1);
  });
});

/**
 * Decals and overhangs are the other two layers. All three manage instances identically — the same
 * matrix, arriving and leaving with the building — and differ only in geometry source and whether
 * they cast shadows. So the invariants are tested on all three, or the two newer layers drift.
 */
describe('the massing layer is never scaled either', () => {
  it('should keep the instance matrix free of scale', () => {
    // BUG-219's invariant extends to the massing layer itself. The generators emit final sizes, so
    // an instance matrix should carry only rotation and translation; once scaling returns, the
    // attachment layers again cannot see how wide a building is.
    const scale = new THREE.Vector3();
    const cases: Array<[number, number, 'LOW' | 'HIGH']> = [
      [ZoneType.RESIDENTIAL_LOW, 1, 'LOW'],
      [ZoneType.RESIDENTIAL_HIGH, 3, 'HIGH'],
      [ZoneType.INDUSTRIAL, 2, 'LOW'],
      [ZoneType.OFFICE, 3, 'HIGH'],
    ];
    cases.forEach(([zone, level, density], i) => {
      const { renderer, internals } = fresh();
      renderer.addBuilding(i, 0, zone, density, level, false);
      layerMatrix(internals, 'zoneLayer', i, 0).decompose(
        new THREE.Vector3(), new THREE.Quaternion(), scale,
      );
      expect(scale.x, `zone ${zone} 寬被縮放`).toBeCloseTo(1, 9);
      expect(scale.y, `zone ${zone} 高被縮放`).toBeCloseTo(1, 9);
      expect(scale.z, `zone ${zone} 深被縮放`).toBeCloseTo(1, 9);
    });
  });

  it('should draw every building at the size its variant was generated at', () => {
    // The case above reads the matrix and this one the drawn result; together they close the
    // workaround of moving the scale into geometry generation.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, false);
    const entry = internals.zoneLayer.entryFor('0,0')!;
    const mesh = internals.zoneLayer.meshFor(entry.key)!;
    const authored = new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    const drawn = layerBox(internals, 'zoneLayer', 0, 0);
    expect(drawn.max.y - drawn.min.y).toBeCloseTo(authored.max.y - authored.min.y, 9);
    // Compared in plan as the set of the two axes' spans rather than per axis: a quarter turn swaps
    // x and z.
    const span = (b: THREE.Box3) =>
      [b.max.x - b.min.x, b.max.z - b.min.z].sort((p, q) => p - q);
    const [a0, a1] = span(authored);
    const [d0, d1] = span(drawn);
    expect(d0).toBeCloseTo(a0!, 9);
    expect(d1).toBeCloseTo(a1!, 9);
  });
});

describe('empty buckets cost nothing', () => {
  it('should not draw buckets that hold nothing', () => {
    // The massing buckets go from 60 to 168. three.js still walks the full render list for an
    // InstancedMesh with count === 0, so at three times the bucket count this goes from negligible
    // to noticeable.
    const { renderer, internals } = fresh();
    const layer = internals.zoneLayer;
    for (const [key, mesh] of layer.bucketMap) {
      expect(mesh.visible, `${key} 空桶仍然可見`).toBe(false);
    }
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 2, false);
    let visible = 0;
    for (const [key, mesh] of layer.bucketMap) {
      expect(mesh.visible, `${key} 的可見性與實例數不一致`).toBe(layer.countOf(key) > 0);
      if (mesh.visible) visible++;
    }
    expect(visible, '應該只有一個桶被畫').toBe(1);
  });

  it('should hide the bucket again when its last building goes', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 2, false);
    const key = internals.zoneLayer.entryFor('0,0')!.key;
    renderer.removeBuilding(0, 0);
    expect(internals.zoneLayer.meshFor(key)!.visible).toBe(false);
  });

  it('should hide every bucket again when the map is rebuilt', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 2, false);
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    for (const [key, mesh] of internals.zoneLayer.bucketMap) {
      expect(mesh.visible, `${key} 重建後仍然可見`).toBe(false);
    }
  });
});

describe('decal and overhead layers', () => {
  /** A combination with content in all three layers: from low-density commercial L2, decals, yard and canopy are all present. */
  const SHOP = { zone: ZoneType.COMMERCIAL_LOW, density: 'LOW' as const };

  it('should not let flat decals cast shadows', () => {
    // A quad with no thickness casts a shadow that is a line, and it is computed once per
    // building.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 1, false);
    const entry = internals.decalLayer.entryFor('0,0')!;
    expect(internals.decalLayer.meshFor(entry.key)!.castShadow).toBe(false);
  });

  it('should still let overhead props cast shadows', () => {
    // The converse: a canopy has volume, and the shadow it casts on the sidewalk is exactly what an
    // arcade looks like.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    const entry = internals.overheadLayer.entryFor('0,0')!;
    expect(internals.overheadLayer.meshFor(entry.key)!.castShadow).toBe(true);
  });

  it('should give every zone a forecourt', () => {
    const { renderer, internals } = fresh();
    const cells: Array<[number, number, 'LOW' | 'HIGH']> = [
      [0, ZoneType.RESIDENTIAL_LOW, 'LOW'],
      [1, ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
      [2, ZoneType.COMMERCIAL_LOW, 'LOW'],
      [3, ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [4, ZoneType.INDUSTRIAL, 'LOW'],
      [5, ZoneType.OFFICE, 'LOW'],
      [6, ZoneType.OFFICE, 'HIGH'],
    ];
    for (const [x, zone, density] of cells) {
      renderer.addBuilding(x, 0, zone, density, 3, false);
      expect(internals.decalLayer.entryFor(`${x},0`), `zone ${zone} 沒有前庭`).toBeDefined();
    }
  });

  it('should lay the forecourt at exactly the paving height', () => {
    // Decal geometry carries absolute heights already, since the layering of paving and markings
    // lives in the geometry, so an instance must not add a base height again: it would push the
    // markings to 5 mm and the paving away from the wall's foot.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 1, false);
    expect(layerBox(internals, 'decalLayer', 0, 0).min.y)
      .toBeCloseTo(GROUND_LAYERS.DECAL, 9);
  });

  it('should never scale any of the three layers', () => {
    // BUG-219's invariant extends to the two newer layers: a canopy does not grow with a taller
    // building, and paving does not shrink because the footprint jittered narrower.
    const scale = new THREE.Vector3();
    for (const level of [2, 3]) {
      const { renderer, internals } = fresh();
      renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, level, false);
      for (const layer of ATTACHMENT_LAYERS) {
        layerMatrix(internals, layer, 0, 0).decompose(
          new THREE.Vector3(), new THREE.Quaternion(), scale,
        );
        expect(scale.x, `${layer} L${level} 寬被縮放`).toBeCloseTo(1, 9);
        expect(scale.y, `${layer} L${level} 高被縮放`).toBeCloseTo(1, 9);
        expect(scale.z, `${layer} L${level} 深被縮放`).toBeCloseTo(1, 9);
      }
    }
  });

  it('should take all three layers away with the building', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.addBuilding(1, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.removeBuilding(0, 0);
    for (const layer of ATTACHMENT_LAYERS) {
      expect(internals[layer].entryFor('0,0'), `${layer} 留下孤兒`).toBeUndefined();
      expect(internals[layer].entryFor('1,0'), `${layer} 誤刪鄰居`).toBeDefined();
    }
  });

  it('should swap all three layers when the shop upgrades', () => {
    // All three layers' contents differ by level, so an upgrade has to change buckets: with only
    // the matrix updated, an L3 shop keeps L2's paving and canopy.
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, SHOP.zone, SHOP.density, 2, false);
    const before = ATTACHMENT_LAYERS.map(l => internals[l].entryFor('0,0')!.key);
    renderer.updateBuilding(0, 0, SHOP.zone, SHOP.density, 3, false);
    ATTACHMENT_LAYERS.forEach((layer, i) => {
      expect(internals[layer].entryFor('0,0')!.key, `${layer} 沒跟著升級`)
        .not.toBe(before[i]);
      // The old slot has to be released before switching buckets, or it leaves an ownerless
      // instance: the index points at the new bucket, the old copy is never removed, and on screen
      // L2's paving sits under L3's. This reads the old bucket's instance count, since the index is
      // keyed by cell and an orphan does not grow its size.
      expect(internals[layer].countOf(before[i]!), `${layer} 舊桶留下孤兒`).toBe(0);
    });
  });

  it('should clear all three layers when the map is rebuilt', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 4; x++) renderer.addBuilding(x, 0, SHOP.zone, SHOP.density, 3, false);
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    for (const layer of ATTACHMENT_LAYERS) {
      expect(internals[layer].size, `${layer} 沒清乾淨`).toBe(0);
    }
  });

  it('should keep every remaining forecourt on its own building after removals', () => {
    // A swap-with-last index bug only surfaces after a removal and does not show on screen.
    const { renderer, internals } = fresh();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        renderer.addBuilding(x, y, SHOP.zone, SHOP.density, 3, false);
        cells.push([x, y]);
      }
    }
    for (let i = 0; i < cells.length; i += 3) {
      renderer.removeBuilding(cells[i]![0], cells[i]![1]);
    }
    const pos = new THREE.Vector3();
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 === 0) continue;
      const [x, y] = cells[i]!;
      for (const layer of ATTACHMENT_LAYERS) {
        pos.setFromMatrixPosition(layerMatrix(internals, layer, x, y));
        expect(pos.x, `${layer} ${x},${y} 跑到別人家`).toBeCloseTo(x, 6);
        expect(pos.z, `${layer} ${x},${y} 跑到別人家`).toBeCloseTo(y, 6);
      }
    }
  });
});

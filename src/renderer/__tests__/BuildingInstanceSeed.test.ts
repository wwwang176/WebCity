import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { getVariants } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * InstancedMesh 的移除是 swap-with-last，所以每次移除都在搬動別人的索引。
 * 桶的數量在第二階段會從 17 成長到 144，索引搬錯的機會跟著變多，而畫面上
 * 只會表現成「某棟樓忽然變成別的樣子」，很難追。這裡把不變式釘住。
 */
const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

/** 一個真的、空的 Grid —— 比假物件安全，也不需要 `as never`。 */
function freshRenderer(): { renderer: BuildingRenderer; internals: Internals } {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

function expectedAppearance(x: number, y: number) {
  const variants = getVariants(ZONE, 1);
  return appearanceOf({
    x, y, zoneType: ZONE, level: 1, seedByte: 0,
    variantCount: variants.length, paletteSize: 1,
  });
}

describe('instance bookkeeping', () => {
  it('should put every building in the bucket appearanceOf names', () => {
    // 掃一整片而不是抽一格：住宅低密度只有三個變體，任何一格都有三分之一
    // 的機會讓舊雜湊與新雜湊剛好選到同一個，單格斷言會巧合通過。
    const { renderer, internals } = freshRenderer();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) renderer.addBuilding(x, y, ZONE, 1, false);
    }

    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const entry = internals.positionToInstance.get(`${x},${y}`);
        expect(entry, `no instance for ${x},${y}`).toBeDefined();
        expect(entry!.key, `wrong bucket at ${x},${y}`)
          .toBe(`${ZONE}_${expectedAppearance(x, y).variantIndex}`);
      }
    }
  });

  it('should keep every surviving building pointing at its own matrix', () => {
    const { renderer, internals } = freshRenderer();

    const alive: Array<[number, number]> = [];
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        renderer.addBuilding(x, y, ZONE, 1, false);
        alive.push([x, y]);
      }
    }
    // 移除三分之一，逼出 swap-with-last
    for (let i = alive.length - 1; i >= 0; i -= 3) {
      const [x, y] = alive[i]!;
      renderer.removeBuilding(x, y);
      alive.splice(i, 1);
    }

    const m = new THREE.Matrix4();
    for (const [x, y] of alive) {
      const entry = internals.positionToInstance.get(`${x},${y}`);
      expect(entry, `no instance for ${x},${y}`).toBeDefined();
      internals.variantMeshes.get(entry!.key)!.getMatrixAt(entry!.idx, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x, `instance for ${x},${y} sits at ${p.x},${p.z}`).toBeCloseTo(x, 5);
      expect(p.z).toBeCloseTo(y, 5);
    }
  });
});

describe('aSeed', () => {
  it('should exist on every variant mesh with three components per instance', () => {
    const { internals } = freshRenderer();
    expect(internals.variantMeshes.size).toBeGreaterThan(0);
    for (const [key, mesh] of internals.variantMeshes) {
      const attr = mesh.geometry.getAttribute('aSeed');
      expect(attr, `${key} has no aSeed`).toBeDefined();
      expect(attr.itemSize, `${key} aSeed itemSize`).toBe(3);
    }
  });

  it('should carry the facade seed appearanceOf gives that cell', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(6, 2, ZONE, 1, false);

    const entry = internals.positionToInstance.get('6,2')!;
    const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');
    const expected = expectedAppearance(6, 2).facadeSeed;

    expect(attr.getX(entry.idx)).toBeCloseTo(expected[0], 6);
    expect(attr.getY(entry.idx)).toBeCloseTo(expected[1], 6);
    expect(attr.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
  });

  it('should follow the building when swap-with-last moves it', () => {
    // aOccupancy 已經有搬移邏輯，aSeed 漏搬的話，被搬動的那棟樓會戴上
    // 另一棟樓的立面 —— 而且只在玩家拆除建築之後才發生。
    const { renderer, internals } = freshRenderer();

    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push([x, y]);
    for (const [x, y] of cells) renderer.addBuilding(x, y, ZONE, 1, false);
    for (let i = 0; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      renderer.removeBuilding(x, y);
    }

    for (let i = 1; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');
      const expected = expectedAppearance(x, y).facadeSeed;
      expect(attr.getX(entry.idx), `aSeed.x wrong at ${x},${y}`).toBeCloseTo(expected[0], 6);
      expect(attr.getY(entry.idx), `aSeed.y wrong at ${x},${y}`).toBeCloseTo(expected[1], 6);
      expect(attr.getZ(entry.idx), `aSeed.z wrong at ${x},${y}`).toBeCloseTo(expected[2], 6);
    }
  });
});

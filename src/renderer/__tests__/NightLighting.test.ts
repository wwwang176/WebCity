import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { BUILDING_FRAG } from '../BuildingMaterial';
import { getGroundPropVariants } from '../geometry/buildings/groundProps';
import { getOverheadVariants } from '../geometry/buildings/overheadProps';
import { getMassingVariants } from '../geometry/buildings/massing';
import { PART_THRESHOLDS, PART_LAMP } from '../geometry/buildings/parts';
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * The pieces that glow at night.
 *
 * `PART_DETAIL` carrying both the equipment that should be cold metal — water tanks, pipe racks,
 * stacks — and the things that should glow — lamp heads, signage, billboards — gives one tag two
 * meanings, and there is then no way to light only the second. The only option is that neither
 * lights.
 */
const isLampTag = (p: number) => p > PART_THRESHOLDS.LAMP_MIN && p < PART_THRESHOLDS.FOLIAGE_MIN;

function countTagged(geo: THREE.BufferGeometry, pred: (p: number) => boolean): number {
  const col = geo.getAttribute('color');
  let n = 0;
  for (let i = 0; i < col.count; i++) if (pred(col.getX(i))) n++;
  return n;
}

describe('the lamp tag is its own band', () => {
  it('should sit between the detail band and the foliage band', () => {
    expect(PART_LAMP).toBeGreaterThan(PART_THRESHOLDS.LAMP_MIN);
    expect(PART_LAMP).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MIN);
    expect(PART_THRESHOLDS.LAMP_MIN).toBeGreaterThan(PART_THRESHOLDS.ROOF_BY_NORMAL);
  });

  it('should not swallow the cold metal that used to share the detail tag', () => {
    // Water tanks, pipe racks and stacks are tagged PART_DETAIL at 0.2, which has to fall **below**
    // the lamp threshold.
    expect(0.2).toBeLessThan(PART_THRESHOLDS.LAMP_MIN);
  });
});

describe('what glows at night', () => {
  it('should light the shop sign and the billboard', () => {
    // A sign is a light box. From low-density commercial L2 upward the overhead layer always has a
    // projecting sign.
    let found = 0;
    for (const level of LEVELS) {
      for (const build of getOverheadVariants(ZoneType.COMMERCIAL_LOW, 'LOW', level)) {
        const geo = build();
        found += countTagged(geo, isLampTag);
        geo.dispose();
      }
    }
    expect(found, '商業低密度的懸挑層沒有任何會發光的零件').toBeGreaterThan(0);
  });

  it('should light the lamp head but not the pole', () => {
    // Tagging the whole thing as glowing gives a post lit from the ground to the top at night.
    const geo = getGroundPropVariants(ZoneType.OFFICE, 'LOW', 3)
      .map(b => b())
      .reduce((a, b) => (countTagged(a, isLampTag) >= countTagged(b, isLampTag) ? a : b));
    const lampVerts = countTagged(geo, isLampTag);
    const detailVerts = countTagged(
      geo, p => p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.LAMP_MIN,
    );
    expect(lampVerts, '辦公 L3 的庭園燈沒有發光的燈頭').toBeGreaterThan(0);
    expect(detailVerts, '整組零件都標成發光了').toBeGreaterThan(lampVerts);
  });

  it('should keep the massing free of lamps', () => {
    // Stacks, silos and water tanks are cold. A glowing tag in the massing layer is a mis-tag.
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        for (const build of getMassingVariants(Number(zs), ds as Density, level)) {
          const geo = build();
          expect(countTagged(geo, isLampTag), `${key} L${level} 的量體長出發光零件`).toBe(0);
          geo.dispose();
        }
      }
    }
  });

  it('should gate the glow on occupancy', () => {
    // An empty building should not glow.
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('} else if (isLamp)'),
      BUILDING_FRAG.indexOf('} else if (isDetail)'),
    );
    expect(branch.length, '找不到 isLamp 分支').toBeGreaterThan(0);
    expect(branch, '燈的亮暗沒有看住戶').toContain('vOccupancy');
    expect(branch).toContain('emissive');
  });

  it('should branch on the lamp tag before it reaches the wall branch', () => {
    // Falling to the wall branch grows windows: a grid of them across a sign.
    const lampAt = BUILDING_FRAG.indexOf('isLamp');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(lampAt).toBeGreaterThan(-1);
    expect(lampAt).toBeLessThan(wallAt);
  });
});

describe('no zone is left dark', () => {
  /** The start markers of each zone's branch in the facade shader, in source order. */
  const MARKERS = [
    'RESIDENTIAL LOW', 'RESIDENTIAL HIGH', 'COMMERCIAL LOW',
    'COMMERCIAL HIGH', 'INDUSTRIAL', 'OFFICE',
  ];

  it('should let every zone put something behind glass', () => {
    // With industry setting no windowMask at all — no panes, and a roller door as a dark patch — the
    // whole industrial zone is black at night. This is that in machine-checkable form: a zone branch
    // missing its night handling turns it red.
    const idx = MARKERS.map((m) => {
      const at = BUILDING_FRAG.indexOf(m);
      expect(at, `找不到 ${m} 分支`).toBeGreaterThan(-1);
      return at;
    });
    for (let i = 0; i < MARKERS.length; i++) {
      const end = i + 1 < idx.length ? idx[i + 1]! : BUILDING_FRAG.indexOf('Apply shadow');
      const branch = BUILDING_FRAG.slice(idx[i]!, end);
      expect(branch, `${MARKERS[i]} 分支在夜裡是全黑的`).toContain('windowMask =');
      expect(branch, `${MARKERS[i]} 分支沒有看住戶`).toContain('occ');
    }
  });
});

describe('occupancy reaches the layers that need it', () => {
  interface Internals {
    attachments: ReadonlyArray<{ layer: {
      bucketMap: ReadonlyMap<string, THREE.InstancedMesh>;
      countOf(key: string): number;
      entryFor(posKey: string): { key: string; idx: number } | undefined;
    } }>;
    updateOccupancy(r: Map<string, number>): void;
  }

  function fresh(): { renderer: BuildingRenderer; internals: Internals } {
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(1, 1));
    return { renderer, internals: renderer as unknown as Internals };
  }

  /** A renderer with all four layers built and populated. */
  function populated(): Internals {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.COMMERCIAL_LOW, 'LOW', 3, false);
    return internals;
  }

  it('should write occupancy onto the attachment layers, not just the massing', () => {
    // Signage and lamp heads live in the overhead and low-prop layers. With updateOccupancy walking
    // the massing layer alone, those two layers' aOccupancy stays at 0 forever and every sign in the
    // city is dark, with nothing on screen distinguishing "the data never arrived" from "it was
    // designed not to light".
    const r = populated();
    r.updateOccupancy(new Map([['0,0', 0.8]]));

    let checked = 0;
    for (const a of r.attachments) {
      for (const [key, mesh] of a.layer.bucketMap) {
        if (a.layer.countOf(key) === 0) continue;
        const attr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
        expect(attr, `${key} 沒有 aOccupancy`).toBeDefined();
        expect((attr.array as Float32Array)[0], `${key} 的 occupancy 沒有寫進去`)
          .toBeCloseTo(0.8, 5);
        checked++;
      }
    }
    expect(checked, '沒有任何附掛層放到實例，這條測試等於空轉').toBeGreaterThan(0);
  });

  it('should start a freshly placed attachment dark, not wearing the last tenant`s glow', () => {
    // An acquired slot can still hold the **previous occupant's** value: on removal, swap-with-last
    // moves the last instance's data into the vacated slot and that data remains at its original
    // position too. An empty buffer is 0 to begin with, so one building tests nothing here.
    const { renderer, internals } = fresh();
    const Z = ZoneType.COMMERCIAL_LOW;
    // Filling the area and clearing it is what guarantees every bucket's buffer holds stale values.
    // With two buildings, whether a new one lands on a dirty slot depends on the hash and the test
    // becomes a dice roll.
    const ratios = new Map<string, number>();
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        renderer.addBuilding(x, y, Z, 'LOW', 3, false);
        ratios.set(`${x},${y}`, 0.9);
      }
    }
    internals.updateOccupancy(ratios);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) renderer.removeBuilding(x, y);
    renderer.addBuilding(0, 0, Z, 'LOW', 3, false);

    let checked = 0;
    for (const a of internals.attachments) {
      const entry = a.layer.entryFor('0,0');
      if (!entry) continue;
      const mesh = a.layer.bucketMap.get(entry.key)!;
      const attr = mesh.geometry.getAttribute('aOccupancy') as THREE.InstancedBufferAttribute;
      expect((attr.array as Float32Array)[entry.idx], `${entry.key} 頂著上一戶的招牌亮著`)
        .toBe(0);
      checked++;
    }
    expect(checked, '新建築沒有落在任何附掛層，這條測試等於空轉').toBeGreaterThan(0);
  });
});

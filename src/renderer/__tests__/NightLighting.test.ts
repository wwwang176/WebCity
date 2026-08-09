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
 * 夜間發光的零件。
 *
 * `PART_DETAIL` 原本同時裝了「該是冷金屬的設備」（水塔、管架、煙囪）與
 * 「該發光的東西」（燈頭、招牌、看板）。一個標籤兩種語意，所以沒有辦法只讓
 * 後者亮 —— 唯一的選擇是兩者都不亮，而那正是改版前的狀態。
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
    // 水塔、管架、煙囪標的是 PART_DETAIL 0.2 —— 它必須落在燈的門檻**之下**。
    expect(0.2).toBeLessThan(PART_THRESHOLDS.LAMP_MIN);
  });
});

describe('what glows at night', () => {
  it('should light the shop sign and the billboard', () => {
    // 招牌是燈箱。商業低密度 L2 以上的懸挑層一定有側招。
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
    // 整支都標成發光的話，夜裡會看到一根從地上亮到頂的柱子。
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
    // 煙囪、筒倉、水塔是冷的。量體層長出發光標籤就是標錯了。
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
    // 使用者的條件：沒有人的建築不應該發光。
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('} else if (isLamp)'),
      BUILDING_FRAG.indexOf('} else if (isDetail)'),
    );
    expect(branch.length, '找不到 isLamp 分支').toBeGreaterThan(0);
    expect(branch, '燈的亮暗沒有看住戶').toContain('vOccupancy');
    expect(branch).toContain('emissive');
  });

  it('should branch on the lamp tag before it reaches the wall branch', () => {
    // 落到牆的分支就會長出窗戶 —— 一面招牌上一格一格的窗。
    const lampAt = BUILDING_FRAG.indexOf('isLamp');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(lampAt).toBeGreaterThan(-1);
    expect(lampAt).toBeLessThan(wallAt);
  });
});

describe('no zone is left dark', () => {
  /** 立面 shader 裡各分區分支的起點標記，照原始碼的順序。 */
  const MARKERS = [
    'RESIDENTIAL LOW', 'RESIDENTIAL HIGH', 'COMMERCIAL LOW',
    'COMMERCIAL HIGH', 'INDUSTRIAL', 'OFFICE',
  ];

  it('should let every zone put something behind glass', () => {
    // 工業原本完全沒有設 windowMask —— 沒有窗格、捲門只是一塊暗色，所以
    // 整個工業區在夜裡是全黑的。這一條是那件事的機器可檢查形式：分區分支
    // 一旦漏掉夜間的處理，它就轉紅。
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

  /** 四層都建起來、都放了實例的渲染器。 */
  function populated(): Internals {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.COMMERCIAL_LOW, 'LOW', 3, false);
    return internals;
  }

  it('should write occupancy onto the attachment layers, not just the massing', () => {
    // 招牌與燈頭住在懸挑層與矮物件層。updateOccupancy 原本只走量體層，
    // 所以那兩層的 aOccupancy 永遠停在 0 —— 整座城市的招牌都是暗的，
    // 而畫面上完全看不出是「資料沒送到」還是「本來就設計成不亮」。
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
    // 取到的位置可能留著**上一個佔用者**的值 —— swap-with-last 在移除時把
    // 最後一個實例的資料搬進空出來的槽，那份資料還留在原本的位置上。
    // 空的緩衝區本來就是 0，所以只放一棟建築測不出這件事。
    const { renderer, internals } = fresh();
    const Z = ZoneType.COMMERCIAL_LOW;
    // 整片放滿再整片拆掉，才保證每個桶的緩衝區裡都留著舊值 —— 只放兩棟的話
    // 新建築會不會落到髒的槽要看雜湊，測試變成擲骰子。
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

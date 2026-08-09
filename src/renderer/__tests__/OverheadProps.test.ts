import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../geometry/buildings/overheadProps';
import { OVERHEAD_CLEARANCE, buildingEdge } from '../geometry/buildings/propBands';
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachOverhead(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const level of LEVELS) {
      const variants = getOverheadVariants(z, d, level);
      for (let i = 0; i < variants.length; i++) {
        const geo = variants[i]!();
        fn(geo, `${key} L${level} v${i}`);
        geo.dispose();
      }
    }
  });
}

describe('overhead props', () => {
  it('should never hang low enough to hit a walking person', () => {
    // 這是懸挑物件唯一的存在理由：行人從下面走過。低於淨空就是穿模。
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `${label} 會打到頭`)
        .toBeGreaterThanOrEqual(OVERHEAD_CLEARANCE - 1e-6);
    });
  });

  it('should actually reach past the pedestrian envelope', () => {
    // 全都縮在建築輪廓裡的話，這一層沒有存在的意義 —— 那就只是立面零件。
    const reaching: string[] = [];
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      if (outer > HALF_ENVELOPE) reaching.push(label);
    });
    expect(reaching.length, '沒有任何懸挑物真的挑出去').toBeGreaterThan(0);
  });

  it('should stop at the cell edge', () => {
    // 越過格子邊界就會插進鄰居的建築裡。
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(outer, `${label} 伸進鄰居家`).toBeLessThanOrEqual(CELL_EDGE + 1e-6);
    });
  });

  it('should stay attached to the building, not float in mid-air', () => {
    // 內緣要碰到建築牆面，否則雨遮浮在半空。
    //
    // 判定用「有頂點正好落在建築外緣上」而不是包圍盒的最近距離：橫跨整個
    // 立面的雨遮，四個角在另一軸上都遠離中心，包圍盒量不到它其實貼著牆。
    eachBucket((z, d, key) => {
      const edge = buildingEdge(z, d)!;
      for (const level of LEVELS) {
        for (const build of getOverheadVariants(z, d, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          let touches = false;
          for (let i = 0; i < pos.count && !touches; i++) {
            touches = Math.abs(Math.abs(pos.getX(i)) - edge) < 1e-6
              || Math.abs(Math.abs(pos.getZ(i)) - edge) < 1e-6;
          }
          expect(touches, `${key} L${level} 沒有貼到牆`).toBe(true);
          geo.dispose();
        }
      }
    });
  });

  it('should never be tagged as wall', () => {
    // 雨遮長出一格一格的窗會很怪。
    eachOverhead((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i), `${label} 頂點 ${i} 標成 PART_WALL`).toBeGreaterThan(0.1);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachOverhead((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(OVERHEAD_TRIANGLE_BUDGET);
    });
  });

  it('should give commercial, office and industrial something at level 3', () => {
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [ZoneType.OFFICE, 'LOW'], [ZoneType.OFFICE, 'HIGH'],
      [ZoneType.INDUSTRIAL, 'LOW'], [ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      expect(getOverheadVariants(zone, density, 3).length, `zone ${zone}/${density}`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('should leave the detached house alone', () => {
    // 獨棟住宅沒有騎樓也沒有招牌。硬加會讓它看起來像店面。
    for (const level of LEVELS) {
      expect(getOverheadVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)).toHaveLength(0);
    }
  });

  it('should earn its overhang with level', () => {
    // L1 樸素、L3 有騎樓與招牌。這一層本身就是等級階梯的一部分。
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      const tris = (lv: number) => getOverheadVariants(zone, density, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tris(3), `zone ${zone} L3`).toBeGreaterThan(tris(1));
    }
  });
});

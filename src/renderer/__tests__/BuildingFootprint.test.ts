import { describe, it, expect } from 'vitest';
import {
  TARGET_WIDTHS_M, variantWidthUnits, footprintScaleFor, getVariants, LEVELS,
  type Density,
} from '../geometry/buildings/registry';
import { METRES_PER_CELL, MAX_BUILDING_WIDTH_M } from '../../core/grid/constants';
import {
  BUILDING_HALF_SIZE, WALKWAY_OFFSET,
} from '../../core/traffic/SidewalkGraph';
import { ZoneType } from '../../core/grid/types';

/**
 * 建築原本一律 7-8 m 寬、只佔 12 m 格子的 60%，所以 42 m 的高層住宅是
 * 5.5:1 的細針 —— 「太高」的觀感有一半來自太瘦。
 *
 * 放寬基地的風險是越界壓到鄰居或馬路，而那在畫面上不明顯 ——
 * BUG-218 就是這樣被包圍盒測試抓到的。
 */
const CASES: Array<[number, Density]> = [
  [ZoneType.RESIDENTIAL_LOW, 'LOW'],
  [ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
  [ZoneType.COMMERCIAL_LOW, 'LOW'],
  [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
  [ZoneType.INDUSTRIAL, 'LOW'],
  [ZoneType.OFFICE, 'LOW'],
  [ZoneType.OFFICE, 'HIGH'],
];

describe('TARGET_WIDTHS_M', () => {
  it('should never ask for more than the cell can hold', () => {
    for (const width of Object.values(TARGET_WIDTHS_M)) {
      expect(width).toBeLessThanOrEqual(METRES_PER_CELL);
    }
  });

  it('should never push a building through the pedestrian walkway', () => {
    // 行人的門與走道節點放在建築牆面外側 WALKWAY_OFFSET 處。建築比
    // SidewalkGraph 假設的還寬，行人就會走進建築裡面 —— 而那在畫面上
    // 不明顯，只有走近看才會發現有人穿牆。
    for (const [key, width] of Object.entries(TARGET_WIDTHS_M)) {
      expect(width, `${key} is wider than the walkway allows`)
        .toBeLessThanOrEqual(MAX_BUILDING_WIDTH_M);
      expect(width / METRES_PER_CELL / 2, `${key} reaches the door nodes`)
        .toBeLessThanOrEqual(BUILDING_HALF_SIZE);
    }
  });

  it('should leave the walkway itself inside the cell', () => {
    // 角節點是最外側的那一個：門節點再往外半個 WALKWAY_OFFSET。
    const cornerNodeDist = BUILDING_HALF_SIZE + WALKWAY_OFFSET * 1.5;
    expect(cornerNodeDist).toBeLessThanOrEqual(0.5);
  });

  it('should keep low density loose and high density close to full', () => {
    // 低密度的留白是院子、車道與樹的位置。
    expect(TARGET_WIDTHS_M['1:LOW']! / METRES_PER_CELL).toBeLessThan(0.7);
    expect(TARGET_WIDTHS_M['2:HIGH']! / METRES_PER_CELL).toBeGreaterThan(0.8);
  });
});

describe('footprintScaleFor', () => {
  it('should never let a building cross into its neighbour, even at max jitter', () => {
    // 逐實例寬深抖動最大 1.15，未縮放幾何置中，所以縮放後的半寬乘上抖動
    // 必須留在半格（0.5 world unit）之內。
    for (const [zone, density] of CASES) {
      for (const level of LEVELS) {
        const variants = getVariants(zone, level);
        for (let i = 0; i < variants.length; i++) {
          const halfWidth = variantWidthUnits(zone, density, level, i) / 2;
          const scaled = halfWidth * footprintScaleFor(zone, density, level, i) * 1.15;
          expect(scaled, `zone ${zone} ${density} L${level} v${i} overflows`)
            .toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('should widen a high-density tower well past its authored width', () => {
    const zone = ZoneType.RESIDENTIAL_HIGH;
    for (const level of LEVELS) {
      expect(footprintScaleFor(zone, 'HIGH', level, 0),
        `res-high L${level} was not widened`).toBeGreaterThan(1.2);
    }
  });

  it('should leave low-density houses roughly as authored', () => {
    // 院子要留著，所以這裡不該有大幅放寬。
    for (const level of LEVELS) {
      const scale = footprintScaleFor(ZoneType.RESIDENTIAL_LOW, 'LOW', level, 0);
      expect(scale).toBeGreaterThan(0.8);
      expect(scale).toBeLessThan(1.3);
    }
  });

  it('should not divide by zero for a zone with no buildings', () => {
    expect(Number.isFinite(footprintScaleFor(ZoneType.NONE, 'LOW', 1, 0))).toBe(true);
  });
});

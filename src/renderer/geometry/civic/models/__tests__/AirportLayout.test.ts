import { describe, it, expect } from 'vitest';
import { airportLayout } from '../airport';
import { getInfraConfig, type InfraType } from '../../../../../core/building/InfraConfig';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { AirportSize } from '../../../../../core/transport/AirportSystem';

const m = (cells: number) => cells * METRES_PER_CELL;

const SIZES = [
  ['小型', 'SMALL', 'airport_s'],
  ['中型', 'MEDIUM', 'airport_m'],
  ['大型', 'LARGE', 'airport_l'],
] as const;

/**
 * 航路表本身合不合理。
 *
 * `Airport.test.ts` 測的是「幾何與航路表一致」—— 那些測試全部是**相對**的，
 * 所以表一動幾何跟著動，永遠自洽。實測過：把小型機場的跑道從 z = 1.20 挪到
 * 0.40，兩邊都是綠的，而停機坪只剩 0.59 格（7 m）深 —— 放不下一架 10.8 m
 * 的飛機。
 *
 * 這個檔案是另一半：**表填了離譜的值會怎樣**。它問的是絕對的問題 ——
 * 每一條帶還放得下該放的東西嗎。
 */
describe.each(SIZES)('%s機場的航路表', (_label, size, type) => {
  const cfg = getInfraConfig(type as InfraType)!;
  const layout = airportLayout(size as AirportSize, cfg.height);
  const halfH = cfg.height / 2;
  const halfW = cfg.width / 2;

  it('should keep every runway inside the plot', () => {
    for (const r of layout.runwayBands) {
      expect(r.z0, `跑道 ${r.c} 的後緣掉出佔地`).toBeGreaterThanOrEqual(-halfH);
      expect(r.c, `跑道 ${r.c} 的中線掉出佔地`).toBeLessThanOrEqual(halfH);
      expect(r.z1 - r.z0, `跑道 ${r.c} 的帶是空的`).toBeGreaterThan(0);
    }
  });

  it('should not overlap the runway bands', () => {
    const sorted = [...layout.runwayBands].sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.z0, '兩條跑道帶重疊了')
        .toBeGreaterThanOrEqual(sorted[i - 1]!.z1 - 1e-9);
    }
  });

  it('should keep parallel runways far enough apart to be two runways', () => {
    // 兩條中線靠得太近的話，「不重疊」仍然成立（帶會自己縮），但畫面上那是
    // 一條寬跑道加一條 2 m 的細帶，而兩架飛機會在上面撞在一起。
    // 16.8 m 是這裡的跑道帶寬（`RUNWAY_HALF` 的兩倍）。
    const cs = layout.runwayBands.map(r => r.c).sort((a, b) => a - b);
    for (let i = 1; i < cs.length; i++) {
      const gap = m(cs[i]! - cs[i - 1]!);
      expect(gap, `兩條跑道只隔 ${gap.toFixed(1)} m`).toBeGreaterThanOrEqual(16.8);
    }
  });

  it('should leave the terminal somewhere to stand', () => {
    // 航廈帶從佔地後緣到 `termFront`。12 m 是一棟航廈的最小深度。
    const depth = layout.termFront - (-halfH);
    expect(m(depth), `航廈只剩 ${m(depth).toFixed(1)} m 深`).toBeGreaterThan(12);
  });

  it('should leave the apron deep enough for an aeroplane', () => {
    // 飛機 11.7 × 10.8 m。停機坪比它淺的話，停在機位上的飛機會壓進航廈
    // 或滑行道 —— 而每一條「幾何與航路一致」的測試仍然是綠的。
    const depth = layout.apronBack - layout.termFront;
    expect(m(depth), `停機坪只剩 ${m(depth).toFixed(1)} m 深`).toBeGreaterThan(11);
  });

  it('should put the apron lane between the gates and the runway', () => {
    // 聯絡道跑到機位後面的話，飛機要穿過航廈才進得了機位。
    for (const g of layout.gates) {
      expect(g.z, `機位 ${g.x} 沒有在聯絡道後面`).toBeLessThan(layout.laneZ);
    }
    expect(layout.laneZ, '聯絡道跑到跑道上了').toBeLessThan(layout.apronBack);
  });

  it('should keep the taxiways inside the plot', () => {
    expect(layout.taxiX, '縱向滑行道跑出佔地').toBeLessThan(halfW);
    // 而且要在機位群之外 —— 壓在機位上的話飛機進不了停機位。
    for (const g of layout.gates) {
      expect(Math.abs(g.x), `機位 ${g.x} 壓在縱向滑行道上`)
        .toBeLessThan(layout.taxiX);
    }
  });

  it('should keep every gate inside the plot', () => {
    for (const g of layout.gates) {
      expect(Math.abs(g.x), `機位 ${g.x} 掉出佔地`).toBeLessThan(halfW);
      expect(Math.abs(g.z), `機位 z=${g.z} 掉出佔地`).toBeLessThan(halfH);
    }
  });
});

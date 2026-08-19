import { describe, it, expect } from 'vitest';
import { getCongestionRate, getSpeedMultiplier, CONGESTION } from '../Congestion';

/**
 * 這裡原本還有一組 `TrafficSimulation.getCongestionLevel` 的案例 —— 那支是拿
 * 「畫面上有幾台車」算全城壅塞的，已經整支移除:車輛實體有數量上限、會被生成點
 * 檢查擋掉，那是演繹不是模擬，而且實測在任何有規模的城市都貼死在上限（BUG-326）。
 *
 * 現在的壅塞從需求算，見 `RouteCongestion.ts` 與它的測試。
 */

describe('Congestion', () => {
  it('should calculate congestion rate', () => {
    expect(getCongestionRate(8, 10)).toBeCloseTo(0.8);
    expect(getCongestionRate(12, 10)).toBeCloseTo(1.2);
  });

  it('should reduce speed at >80% congestion', () => {
    const multiplier = getSpeedMultiplier(0.85);
    expect(multiplier).toBe(0.5);
  });

  it('should nearly stop at >100% congestion', () => {
    const multiplier = getSpeedMultiplier(1.2);
    expect(multiplier).toBeLessThan(0.2);
  });

  it('should have full speed under 50% congestion', () => {
    expect(getSpeedMultiplier(0.3)).toBe(1);
  });

  it('should recover speed when congestion drops', () => {
    const high = getSpeedMultiplier(0.9);
    const low = getSpeedMultiplier(0.3);
    expect(low).toBeGreaterThan(high);
  });

  it('CONGESTION thresholds should be in ascending order', () => {
    expect(CONGESTION.LOW_THRESHOLD).toBeLessThan(CONGESTION.MEDIUM_THRESHOLD);
    expect(CONGESTION.MEDIUM_THRESHOLD).toBeLessThan(CONGESTION.HIGH_THRESHOLD);
  });

  it('CONGESTION speed multipliers should decrease with congestion', () => {
    expect(CONGESTION.MEDIUM_SPEED).toBeLessThan(1);
    expect(CONGESTION.HIGH_SPEED).toBeLessThan(CONGESTION.MEDIUM_SPEED);
    expect(CONGESTION.MIN_SPEED).toBeLessThan(CONGESTION.HIGH_SPEED);
  });
});

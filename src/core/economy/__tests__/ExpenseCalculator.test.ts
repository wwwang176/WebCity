import { describe, it, expect } from 'vitest';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../ExpenseCalculator';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { PolicyType } from '../../district/types';
import { policyCost } from '../../district/PolicyBilling';

/**
 * 計費看得到的形狀。刻意不用 `as any[]` —— 那個 cast 讓 `active` 換成 `level` 時
 * 型別檢查整個靜音，兩條測試是跑起來才發現壞掉的。
 */
type BillableDistrict = Parameters<typeof calculateDistrictPolicyCost>[0][number];

describe('ExpenseCalculator', () => {
  describe('calculateDistrictPolicyCost', () => {
    // 夾具改用回收 —— 限制型條例（禁重工業、禁高密度）現在刻意不收費，用它們當
    // 夾具的話「有沒有收到錢」全部量到 0，測不出東西。
    const POP = 1000;
    const CELLS = 50;
    const recyclingCost = (level: 1 | 2 | 3) =>
      policyCost(PolicyType.ENCOURAGE_RECYCLING, level, scaleOf({ population: POP, districtCells: CELLS }));

    it('returns 0 when no districts exist', () => {
      expect(calculateDistrictPolicyCost([], scaleOf({ population: POP }))).toBe(0);
    });

    it('returns 0 when no policies are active', () => {
      const districts = [{
        cells: { size: CELLS }, roadCells: 0, chargedDrivers: 0,
        policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 0 }],
      }] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(districts, scaleOf({ population: POP }))).toBe(0);
    });

    it('bills the same policy once it is switched on', () => {
      // Paired positive control: without it, "returns 0" is satisfiable by a
      // calculator that returns 0 for everything.
      const districts = [{
        cells: { size: CELLS }, roadCells: 0, chargedDrivers: 0,
        policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
      }] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(districts, scaleOf({ population: POP }))).toBeCloseTo(recyclingCost(2), 6);
    });

    it('sums costs of active policies across districts', () => {
      const districts = [
        {
          cells: { size: CELLS }, roadCells: 0, chargedDrivers: 0,
          policies: [
            { type: PolicyType.ENCOURAGE_RECYCLING, level: 1 },
            { type: PolicyType.HIGH_DENSITY_BAN, level: 1 },
          ],
        },
        {
          cells: { size: CELLS }, roadCells: 0, chargedDrivers: 0,
          policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 3 }],
        },
      ] satisfies BillableDistrict[];
      // 禁高密度不收費，所以合計只有兩條回收。
      expect(calculateDistrictPolicyCost(districts, scaleOf({ population: POP })))
        .toBeCloseTo(recyclingCost(1) + recyclingCost(3), 6);
    });

    it('scales with each district own size', () => {
      // 同一條政策、同一級，分區畫大一倍費用就跳一倍。這是整個改動的重點。
      const one = [{
        cells: { size: 10 }, roadCells: 10, chargedDrivers: 0,
        policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
      }] satisfies BillableDistrict[];
      const two = [{
        cells: { size: 20 }, roadCells: 20, chargedDrivers: 0,
        policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
      }] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(two, scaleOf({ population: POP })))
        .toBeCloseTo(calculateDistrictPolicyCost(one, scaleOf({ population: POP })) * 2, 6);
    });
  });

  describe('calculateTotalExpenses', () => {
    it('sums all expense categories', () => {
      const result = calculateTotalExpenses({
        roadMaintenance: 100,
        serviceCost: 200,
        policyCost: 50,
        transportCost: 150,
        elevatedMaintenance: 0,
      });
      expect(result).toBe(500);
    });

    it('returns 0 when all costs are 0', () => {
      const result = calculateTotalExpenses({
        roadMaintenance: 0,
        serviceCost: 0,
        policyCost: 0,
        transportCost: 0,
        elevatedMaintenance: 0,
      });
      expect(result).toBe(0);
    });
  });
});

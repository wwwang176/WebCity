import { describe, it, expect } from 'vitest';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../ExpenseCalculator';
import { PolicyType } from '../../district/types';

/**
 * 計費看得到的形狀。刻意不用 `as any[]` —— 那個 cast 讓 `active` 換成 `level` 時
 * 型別檢查整個靜音，兩條測試是跑起來才發現壞掉的。
 */
type BillableDistrict = Parameters<typeof calculateDistrictPolicyCost>[0][number];

describe('ExpenseCalculator', () => {
  describe('calculateDistrictPolicyCost', () => {
    it('returns 0 when no districts exist', () => {
      expect(calculateDistrictPolicyCost([])).toBe(0);
    });

    it('returns 0 when no policies are active', () => {
      // Must use a REAL, implemented PolicyType. The fixture used to say
      // 'heavy_traffic_ban', which is not a PolicyType at all — so it was
      // filtered out as unimplemented and this case would have passed with
      // `active` ignored entirely, guarding nothing.
      const districts = [{
        policies: [
          { type: PolicyType.NO_HEAVY_INDUSTRY, level: 0, cost: 150 },
        ],
      }] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(districts)).toBe(0);
    });

    it('bills the same policy once it is switched on', () => {
      // Paired positive control: without it, "returns 0" is satisfiable by a
      // calculator that returns 0 for everything.
      const districts = [{
        policies: [
          { type: PolicyType.NO_HEAVY_INDUSTRY, level: 1, cost: 150 },
        ],
      }] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(districts)).toBe(150);
    });

    it('sums costs of active policies across districts', () => {
      // Real PolicyType values: only implemented policies are billable, so a
      // placeholder type would now (correctly) cost nothing.
      const districts = [
        {
          policies: [
            { type: PolicyType.NO_HEAVY_INDUSTRY, level: 1, cost: 50 },
            { type: PolicyType.HIGH_DENSITY_BAN, level: 0, cost: 100 },
          ],
        },
        {
          policies: [
            { type: PolicyType.HIGH_DENSITY_BAN, level: 1, cost: 30 },
          ],
        },
      ] satisfies BillableDistrict[];
      expect(calculateDistrictPolicyCost(districts)).toBe(80);
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

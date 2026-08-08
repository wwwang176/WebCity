import { describe, it, expect } from 'vitest';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../ExpenseCalculator';
import { PolicyType } from '../../district/types';

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
        id: 'd1',
        name: 'Test',
        policies: [
          { type: PolicyType.NO_HEAVY_INDUSTRY, active: false, cost: 150 },
        ],
      }] as any[];
      expect(calculateDistrictPolicyCost(districts)).toBe(0);
    });

    it('bills the same policy once it is switched on', () => {
      // Paired positive control: without it, "returns 0" is satisfiable by a
      // calculator that returns 0 for everything.
      const districts = [{
        id: 'd1',
        name: 'Test',
        policies: [
          { type: PolicyType.NO_HEAVY_INDUSTRY, active: true, cost: 150 },
        ],
      }] as any[];
      expect(calculateDistrictPolicyCost(districts)).toBe(150);
    });

    it('sums costs of active policies across districts', () => {
      // Real PolicyType values: only implemented policies are billable, so a
      // placeholder type would now (correctly) cost nothing.
      const districts = [
        {
          id: 'd1',
          policies: [
            { type: PolicyType.NO_HEAVY_INDUSTRY, active: true, cost: 50 },
            { type: PolicyType.HIGH_DENSITY_BAN, active: false, cost: 100 },
          ],
        },
        {
          id: 'd2',
          policies: [
            { type: PolicyType.HIGH_DENSITY_BAN, active: true, cost: 30 },
          ],
        },
      ] as any[];
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

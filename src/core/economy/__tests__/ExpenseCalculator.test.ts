import { describe, it, expect } from 'vitest';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../ExpenseCalculator';

describe('ExpenseCalculator', () => {
  describe('calculateDistrictPolicyCost', () => {
    it('returns 0 when no districts exist', () => {
      expect(calculateDistrictPolicyCost([])).toBe(0);
    });

    it('returns 0 when no policies are active', () => {
      const districts = [{
        id: 'd1',
        name: 'Test',
        policies: [
          { type: 'heavy_traffic_ban', active: false, cost: 100 },
        ],
      }] as any[];
      expect(calculateDistrictPolicyCost(districts)).toBe(0);
    });

    it('sums costs of active policies across districts', () => {
      const districts = [
        {
          id: 'd1',
          policies: [
            { type: 'a', active: true, cost: 50 },
            { type: 'b', active: false, cost: 100 },
          ],
        },
        {
          id: 'd2',
          policies: [
            { type: 'c', active: true, cost: 30 },
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

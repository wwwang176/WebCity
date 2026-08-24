import { describe, it, expect } from 'vitest';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../ExpenseCalculator';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { PolicyType } from '../../district/types';
import { policyCost } from '../../district/PolicyBilling';

/**
 * The shape billing actually sees. Deliberately not `as any[]`: that cast silences type
 * checking, so a rename such as `active` to `level` would surface only at run time.
 */
type BillableDistrict = Parameters<typeof calculateDistrictPolicyCost>[0][number];

describe('ExpenseCalculator', () => {
  describe('calculateDistrictPolicyCost', () => {
    // The fixture uses recycling. Restrictive ordinances (no heavy industry, no high density)
    // carry no fee, so as a fixture every "was anything charged" assertion would read 0.
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
      // No-high-density carries no fee, so the total covers only the two recycling entries.
      expect(calculateDistrictPolicyCost(districts, scaleOf({ population: POP })))
        .toBeCloseTo(recyclingCost(1) + recyclingCost(3), 6);
    });

    it('scales with each district own size', () => {
      // Same policy at the same level: doubling the district area doubles the fee.
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

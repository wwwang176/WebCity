import { describe, it, expect } from 'vitest';
import { PolicyType } from '../types';
import { POLICY_CONFIG, POLICY_EFFECTS, IMPLEMENTED_POLICY_TYPES, POLICY_ZONE_RESTRICTIONS, isPolicyImplemented, PolicyManager } from '../PolicyManager';
import { ZoneType } from '../../grid/types';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';
import { policyCost } from '../PolicyBilling';

/** 計費夾具共用的規模。分區格數要跟 fixture 的 `cells.size` 一致。 */
const POP = 1000;
const SCALE = { population: POP, districtCells: 50 };

/**
 * Three of the five district policies — ENCOURAGE_RECYCLING, ORGANIC_FOOD and
 * TOURISM — appeared in no simulation code at all, while
 * calculateDistrictPolicyCost billed every active policy: $380 per cycle for
 * nothing, with the modal advertising the prices as if they bought something
 * (BUG-091). They are implemented now, via POLICY_EFFECTS.
 *
 * What these tests pin is the contract that made that fixable rather than the
 * momentary fact that all five work: a policy is charged if and only if the
 * simulation reads it, and both lists are DERIVED — from
 * POLICY_ZONE_RESTRICTIONS for policies that block construction and from
 * POLICY_EFFECTS for policies that change a number. Adding an entry is all it
 * takes to make a policy real; there is no third list to forget.
 */
/** ZoneType is a numeric enum, so Object.values yields the names too. */
function numericZones(): ZoneType[] {
  return Object.values(ZoneType).filter(z => typeof z === 'number') as ZoneType[];
}

describe('policies are charged only when they do something', () => {
  it('should offer nothing it cannot deliver', () => {
    // Every policy the modal lists and charges for must be one the simulation
    // reads. All five are now, which is the point — but the assertion is the
    // rule, not the count, so a policy added to POLICY_CONFIG alone fails here.
    for (const type of Object.keys(POLICY_CONFIG) as PolicyType[]) {
      expect(isPolicyImplemented(type), type).toBe(true);
    }
  });

  it('should derive the implemented set from the two effect tables', () => {
    const derived = new Set<PolicyType>([
      ...(Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]),
      ...(Object.keys(POLICY_EFFECTS) as PolicyType[]),
    ]);
    expect([...IMPLEMENTED_POLICY_TYPES].sort()).toEqual([...derived].sort());
  });

  it('should not bill a policy the simulation does not read', () => {
    // No policy is unimplemented today, so the guard is exercised with one that
    // is not in either effect table. Deleting the guard makes this fail; a real
    // policy losing its effect would then start billing for nothing again.
    const districts = [{
      cells: { size: 50 },
      policies: [
        { level: 1, type: 'NOT_A_REAL_POLICY' as PolicyType },
        { level: 1, type: PolicyType.TOURISM },
      ],
    }];

    expect(calculateDistrictPolicyCost(districts, POP))
      .toBeCloseTo(policyCost(PolicyType.TOURISM, 1, SCALE), 6);
  });

  it('should not bill restriction policies at all', () => {
    // 限制型條例（禁重工業、禁高密度）以前一起收 150 + 120。它們的代價是機會成本
    // —— 該區長不出高稅收的建築 —— 而不是市府掏錢。再收一次是雙重懲罰，而且那個
    // 數字沒有來由。
    const districts = [{
      cells: { size: 50 },
      policies: [
        { level: 1, type: PolicyType.NO_HEAVY_INDUSTRY },
        { level: 1, type: PolicyType.HIGH_DENSITY_BAN },
      ],
    }];

    expect(calculateDistrictPolicyCost(districts, POP)).toBe(0);
  });

  it('should still bill a policy that costs money', () => {
    // 反面控制:上一條「不收費」單獨看的話，一個永遠回 0 的計算器也會通過。
    const districts = [{
      cells: { size: 50 },
      policies: [{ level: 2, type: PolicyType.ENCOURAGE_RECYCLING }],
    }];
    expect(calculateDistrictPolicyCost(districts, POP)).toBeGreaterThan(0);
  });

  it('should not bill an inactive implemented policy', () => {
    const districts = [{
      cells: { size: 50 },
      policies: [{ level: 0, type: PolicyType.ENCOURAGE_RECYCLING }],
    }];

    expect(calculateDistrictPolicyCost(districts, POP)).toBe(0);
  });

  it('should leave construction untouched for every non-zoning policy', () => {
    // Recycling, Tourism and Organic Food change numbers, not build rights. A
    // policy that quietly blocked construction as a side effect would be
    // indistinguishable, to the player, from the zone tool being broken.
    const nonZoning = (Object.keys(POLICY_EFFECTS) as PolicyType[])
      .filter(t => !(t in POLICY_ZONE_RESTRICTIONS));
    expect(nonZoning.length).toBeGreaterThan(0);

    for (const type of nonZoning) {
      const district = { id: 'd1', policies: [] as { type: PolicyType; active: boolean }[] };
      const mgr = new PolicyManager({ getDistrict: () => district as never });
      mgr.setPolicyLevel('d1', type, 1);
      for (const zone of numericZones()) {
        expect(mgr.canBuildInDistrict('d1', zone), `${type} blocked zone ${zone}`).toBe(true);
      }
    }
  });

  it('should name every policy type, implemented or not', () => {
    // Unimplemented policies still load from old saves and still need a name to
    // be displayed and removed. 價錢已經不在這張表上 —— 它跟著規模走。
    for (const t of Object.values(PolicyType)) {
      expect(POLICY_CONFIG[t]).toBeDefined();
      expect(POLICY_CONFIG[t].name).toBeTruthy();
    }
  });

  it('should actually block construction for every zone-restricting policy', () => {
    // Ties "implemented" to observable behaviour rather than to set membership:
    // each restricting policy must reject the zone types it names, and leave
    // the others alone.
    //
    // Iterates POLICY_ZONE_RESTRICTIONS, not IMPLEMENTED_POLICY_TYPES. The
    // first version iterated the latter and did `POLICY_ZONE_RESTRICTIONS[type]!`
    // — which booby-traps the NON_ZONE_IMPLEMENTED_POLICY_TYPES extension point
    // the same commit introduced: registering a policy implemented via
    // pollution or income would make `blocked` undefined and crash the suite
    // with "not iterable" on a perfectly correct change.
    const restricting = Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[];
    expect(restricting.length).toBeGreaterThan(0);

    for (const type of restricting) {
      const district = { id: 'd1', policies: [] as { type: PolicyType; active: boolean }[] };
      const mgr = new PolicyManager({ getDistrict: () => district as never });
      mgr.setPolicyLevel('d1', type, 1);

      expect(isPolicyImplemented(type)).toBe(true);
      const blocked = POLICY_ZONE_RESTRICTIONS[type]!;
      for (const zone of blocked) {
        expect(mgr.canBuildInDistrict('d1', zone)).toBe(false);
      }
      for (const zone of numericZones().filter(z => !blocked.has(z))) {
        expect(mgr.canBuildInDistrict('d1', zone)).toBe(true);
      }
    }
  });
});

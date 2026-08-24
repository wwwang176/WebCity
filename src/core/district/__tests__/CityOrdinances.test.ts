import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_SCOPE } from '../PolicyScope';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { createGameState } from '../../simulation/GameState';
import { serializeGameState, deserializeGameState } from '../../save/Serializer';

/**
 * Some ordinances act on a city-level pool — total grid demand, education progression, trade
 * prices — and have no location. The test: **if applying it to the whole map is never worse than
 * applying it to part, it is city-wide**. Where is then not a decision, and requiring a district
 * first is only extra clicks.
 */

describe('全城條例', () => {
  it('should remember the level it was set to', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(2);
  });

  it('should give every policy exactly one scope', () => {
    for (const type of Object.values(PolicyType)) {
      expect(['district', 'city'], `${type} 沒有指定範圍`).toContain(POLICY_SCOPE[type]);
    }
  });

  it('should refuse a district policy', () => {
    // A policy that is both district and city scoped applies on both sides and doubles its
    // effect silently.
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING), '分區條例被設進了全城').toBe(0);
  });

  it('should refuse a city ordinance on a district', () => {
    // The reverse is refused too: refusing on one side leaves the other settable, doubling the
    // effect while charging the fee once.
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.ENERGY_REGULATION, 2);
    expect(pm.getPolicyLevel(d.id, PolicyType.ENERGY_REGULATION), '全城條例被設進了分區').toBe(0);
  });

  it('should refuse a city ordinance smuggled in through a save', () => {
    // A save is a file the user can edit. setPolicyLevel stops the normal path, but fromJSON is
    // another way in: a city ordinance inserted into a district there applies its revenue effect
    // twice, once city-wide and once per district, and charges its fee twice.
    const dm = DistrictManager.fromJSON({
      nextId: 2,
      districts: [{
        id: 'district_1', name: 'D', cells: ['1,1'], specialization: 'NONE',
        policies: [{
          id: 'p1', name: 'Energy Regulation',
          type: PolicyType.ENERGY_REGULATION, level: 3,
        }],
      }],
    } as never);
    const pm = new PolicyManager(dm);
    expect(pm.getPolicyLevel('district_1', PolicyType.ENERGY_REGULATION),
      '全城條例從存檔溜進了分區').toBe(0);
    expect(dm.getDistrict('district_1')!.policies,
      '全城條例還留在分區的政策清單裡').toHaveLength(0);
  });

  it('should keep district policies when dropping a smuggled ordinance', () => {
    // The control: discarding everything would also satisfy the test above, at the cost of the
    // player's district policies.
    const dm = DistrictManager.fromJSON({
      nextId: 2,
      districts: [{
        id: 'district_1', name: 'D', cells: ['1,1'], specialization: 'NONE',
        policies: [
          { id: 'p1', name: 'E', type: PolicyType.ENERGY_REGULATION, level: 3 },
          { id: 'p2', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, level: 2 },
        ],
      }],
    } as never);
    const pm = new PolicyManager(dm);
    expect(pm.getPolicyLevel('district_1', PolicyType.ENCOURAGE_RECYCLING),
      '分區政策被一起丟掉了').toBe(2);
  });

  it('should clamp what it stores', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 99);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(3);
    o.setLevel(PolicyType.ENERGY_REGULATION, -1);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(0);
  });

  it('should cost real money at the city scale', () => {
    // A city ordinance's districtCells is always 0. If every ordinance were billed on
    // districtCells, this path would always cost 0 and every related test would be vacuous.
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(scaleOf({ population: 10_000 })), '全城條例不收錢').toBeGreaterThan(0);
    expect(o.totalCost(scaleOf({ population: 10_000 }))).toBeCloseTo(
      policyCost(PolicyType.ENERGY_REGULATION, 2, scaleOf({ population: 10_000 })), 6);
  });

  it('should scale with population', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(scaleOf({ population: 10_000 }))).toBeGreaterThan(o.totalCost(scaleOf({ population: 1_000 })) * 5);
  });

  it('should lower the power demand multiplier as it gets stronger', () => {
    const o = new CityOrdinances();
    expect(o.getPowerDemandMultiplier(), '什麼都沒開就已經在省電').toBe(1);
    o.setLevel(PolicyType.ENERGY_REGULATION, 1);
    const light = o.getPowerDemandMultiplier();
    o.setLevel(PolicyType.ENERGY_REGULATION, 3);
    expect(o.getPowerDemandMultiplier(), '重度沒有比輕度更省電').toBeLessThan(light);
    expect(light, '輕度完全沒有省到電').toBeLessThan(1);
  });

  it('should round-trip through a real save', () => {
    // Calling toJSON/restore directly would not catch GameState or Serializer failing to wire
    // them up.
    const state = createGameState(20, 20);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.ordinances.getLevel(PolicyType.ENERGY_REGULATION)).toBe(3);
  });

  it('should survive a save that predates ordinances', () => {
    const o = new CityOrdinances();
    o.restore(undefined);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(0);
  });

  it('should re-check scope when restoring', () => {
    // A save is a file the user can edit. With restore writing the Map directly, a hand-edited
    // save could put a district policy into effect city-wide.
    const o = new CityOrdinances();
    o.restore({ levels: [[PolicyType.ENCOURAGE_RECYCLING, 3], [PolicyType.ENERGY_REGULATION, 99]] });
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING), '手改的存檔讓分區條例在全城生效').toBe(0);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION), '手改的等級沒有被夾住').toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { PolicyType } from '../types';

/**
 * Gambling, the night economy and a curfew are three answers to one decision: whether this
 * district's nights are open, half open, or closed. All three at once is meaningless and purely
 * profitable when stacked — gambling on top of the night economy is +68.75% commercial revenue,
 * and part of the crime cost can then be bought back with a curfew.
 *
 * Exclusivity has to be enforced in the setter and on the save path. Guarding the UI alone is
 * bypassed by one hand edit to a save.
 */

function setup() {
  const districts = new DistrictManager();
  const d = districts.createDistrict('D');
  return { districts, policies: new PolicyManager(districts), id: d.id };
}

const levelOf = (policies: PolicyManager, id: string, type: PolicyType) =>
  policies.getPolicyLevel(id, type);

/** A save with one district. `specialization` is omitted and `fromJSON` supplies the default. */
function saveWith(policies: { type: PolicyType; level: number }[]) {
  return DistrictManager.fromJSON({
    nextId: 2,
    districts: [{
      id: 'district_1', name: 'D', cells: [],
      policies: policies.map((p, i) => ({
        id: `p${i}`, name: String(p.type), type: p.type, level: p.level,
      })),
    } as never],
  });
}

describe('夜生活的三條條例互斥', () => {
  it('should switch off gambling when curfew comes in', () => {
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.LEGALIZE_GAMBLING, 1);
    policies.setPolicyLevel(id, PolicyType.CURFEW, 2);
    expect(levelOf(policies, id, PolicyType.CURFEW), '宵禁沒有生效').toBe(2);
    expect(levelOf(policies, id, PolicyType.LEGALIZE_GAMBLING), '賭場還開著').toBe(0);
  });

  it('should switch off curfew when gambling comes in', () => {
    // The reverse has to hold too: guarding one direction leaves a curfew followed by gambling
    // with both in effect.
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.CURFEW, 2);
    policies.setPolicyLevel(id, PolicyType.LEGALIZE_GAMBLING, 1);
    expect(levelOf(policies, id, PolicyType.LEGALIZE_GAMBLING), '賭場沒有生效').toBe(1);
    expect(levelOf(policies, id, PolicyType.CURFEW), '宵禁還開著').toBe(0);
  });

  it('should switch off gambling when the milder night economy comes in', () => {
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.LEGALIZE_GAMBLING, 1);
    policies.setPolicyLevel(id, PolicyType.NIGHT_ECONOMY, 1);
    expect(levelOf(policies, id, PolicyType.LEGALIZE_GAMBLING), '賭場還開著').toBe(0);
  });

  it('should leave the group alone when a policy is switched off', () => {
    // Switching one off must not switch the rest of its group off, which would make "off" a
    // button with collateral damage.
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.CURFEW, 2);
    policies.setPolicyLevel(id, PolicyType.LEGALIZE_GAMBLING, 0);
    expect(levelOf(policies, id, PolicyType.CURFEW), '關掉賭場把宵禁也關了').toBe(2);
  });

  it('should not touch policies outside the group', () => {
    // The control: an implementation that switches every policy off would satisfy the tests
    // above.
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    policies.setPolicyLevel(id, PolicyType.CURFEW, 2);
    expect(levelOf(policies, id, PolicyType.ENCOURAGE_RECYCLING), '回收被夜生活的互斥掃到')
      .toBe(3);
  });
});

describe('存檔也要重跑互斥', () => {
  it('should keep only one of a hand-edited save that carries two', () => {
    const districts = saveWith([
      { type: PolicyType.LEGALIZE_GAMBLING, level: 1 },
      { type: PolicyType.CURFEW, level: 2 },
    ]);
    const kept = districts.getDistrict('district_1')!.policies.filter(p => p.level > 0);
    expect(kept.length, '存檔可以繞過互斥，兩條夜生活條例同時生效').toBe(1);
  });

  it('should not drop policies from different groups', () => {
    // The control: discarding everything would also satisfy the test above, at the cost of the
    // player's district policies.
    const districts = saveWith([
      { type: PolicyType.CURFEW, level: 2 },
      { type: PolicyType.ENCOURAGE_RECYCLING, level: 3 },
    ]);
    const kept = districts.getDistrict('district_1')!.policies.filter(p => p.level > 0);
    expect(kept.length, '不同組的政策被一起丟掉了').toBe(2);
  });
});

describe('存檔的互斥結果不能看排列順序', () => {
  const kept = (order: PolicyType[]) => {
    const d = saveWith(order.map(t => ({ type: t, level: 1 })));
    return d.getDistrict('district_1')!.policies.filter(p => p.level > 0).map(p => p.type);
  };

  it('should keep the same one whichever way round the save lists them', () => {
    // Saves can be hand edited, and ordering must not decide which policy survives: one file
    // reading differently in different builds leaves the player no way to know what happened.
    expect(kept([PolicyType.LEGALIZE_GAMBLING, PolicyType.CURFEW]))
      .toEqual(kept([PolicyType.CURFEW, PolicyType.LEGALIZE_GAMBLING]));
  });

  it('should collapse two entries of the same policy into one', () => {
    // Two entries of one PolicyType are not in each other's exclusive group, so the exclusivity
    // check lets them through, while effect() multiplies entry by entry and the setter and UI
    // only touch the first one find() returns: switched off on screen, still in effect.
    const d = saveWith([
      { type: PolicyType.ENCOURAGE_RECYCLING, level: 3 },
      { type: PolicyType.ENCOURAGE_RECYCLING, level: 2 },
    ]);
    const rows = d.getDistrict('district_1')!.policies
      .filter(p => p.type === PolicyType.ENCOURAGE_RECYCLING);
    expect(rows.length, '同一條政策在存檔裡有兩筆，讀進來還是兩筆').toBe(1);
  });
});

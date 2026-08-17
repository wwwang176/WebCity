import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { PolicyType } from '../types';

/**
 * 賭場、夜間經濟、宵禁是同一個決定的三個答案:這一區的夜晚要放開、放一半、還是
 * 關起來。三個同時成立沒有意義，而且疊起來是純賺 —— 賭場疊夜間經濟是商業收入
 * +68.75%，犯罪的代價卻可以再用宵禁抵掉一部分。
 *
 * 互斥必須做在 setter 與存檔兩個地方。只擋 UI 的話，手改一次存檔就繞過去了。
 */

function setup() {
  const districts = new DistrictManager();
  const d = districts.createDistrict('D');
  return { districts, policies: new PolicyManager(districts), id: d.id };
}

const levelOf = (policies: PolicyManager, id: string, type: PolicyType) =>
  policies.getPolicyLevel(id, type);

/** 只有一個分區的存檔。`specialization` 省略掉，`fromJSON` 會補預設值。 */
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
    // 反方向也要成立 —— 只擋一邊的話，先開宵禁再開賭場就兩條都在。
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
    // 關掉一條不該把同組的別條也關掉 —— 那會讓「關閉」變成一顆會誤傷的按鈕。
    const { policies, id } = setup();
    policies.setPolicyLevel(id, PolicyType.CURFEW, 2);
    policies.setPolicyLevel(id, PolicyType.LEGALIZE_GAMBLING, 0);
    expect(levelOf(policies, id, PolicyType.CURFEW), '關掉賭場把宵禁也關了').toBe(2);
  });

  it('should not touch policies outside the group', () => {
    // 反面控制:把所有政策都關掉的實作也會讓上面那幾條過。
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
    // 反面控制:整批丟掉的話上面那條也會過，但玩家的分區政策就沒了。
    const districts = saveWith([
      { type: PolicyType.CURFEW, level: 2 },
      { type: PolicyType.ENCOURAGE_RECYCLING, level: 3 },
    ]);
    const kept = districts.getDistrict('district_1')!.policies.filter(p => p.level > 0);
    expect(kept.length, '不同組的政策被一起丟掉了').toBe(2);
  });
});

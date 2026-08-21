import { describe, it, expect } from 'vitest';
import { AgentPolicy, type PolicyHost } from '../AgentPolicy';
import { PolicyType } from '../../core/district/types';
import { CitySpecType } from '../../core/district/CitySpecialization';
import { maxLevel } from '../../core/district/PolicyManager';

/**
 * 條例與城市特化。
 *
 * ## 為什麼要讀回來確認
 *
 * `CityOrdinances.setLevel()` 跟 `PolicyManager.setPolicyLevel()` 遇到不對的輸入
 * **一律靜靜地 return** —— 範圍不對、分區不存在，什麼都不會發生也不會有訊息。
 * 直接回 `ok: true` 的話，呼叫端會以為條例開了，然後在帳單上找不到它。
 *
 * 所以這一層設完一定讀回來對一次。測試裡有一個「假裝設好其實沒設」的 host 盯著這件事。
 */

function fakeHost(over: Partial<PolicyHost> = {}) {
  const city = new Map<PolicyType, number>();
  const districts = new Map<string, Map<PolicyType, number>>([['d1', new Map()]]);
  const calls: string[] = [];
  let spec = CitySpecType.NONE;
  let pop = 8000;

  const host: PolicyHost & { calls: string[]; setPop: (n: number) => void } = {
    calls,
    setPop: (n) => { pop = n; },
    districtIds: () => [...districts.keys()],
    cityLevel: (t) => city.get(t) ?? 0,
    setCityLevel(t, level) { calls.push(`city ${t}=${level}`); city.set(t, level); },
    districtLevel: (id, t) => districts.get(id)?.get(t) ?? 0,
    setDistrictLevel(id, t, level) {
      calls.push(`${id} ${t}=${level}`);
      districts.get(id)?.set(t, level);
    },
    specialization: () => spec,
    chooseSpecialization(t) {
      calls.push(`spec ${t}`);
      if (t !== CitySpecType.NONE && pop < 5000) return false;
      spec = t;
      return true;
    },
    population: () => pop,
    ...over,
  };
  return { policy: new AgentPolicy(host), host };
}

/** 全城的與分區的各挑一條，寫死型別名字是為了在範圍表改動時就地爆掉。 */
const CITY_WIDE = PolicyType.ENERGY_REGULATION;
const PER_DISTRICT = PolicyType.CONGESTION_CHARGE;

describe('有哪些條例', () => {
  it('should list every policy type with no gaps', () => {
    // 少一條就是 agent 永遠找不到它。
    const listed = fakeHost().policy.list().map(p => p.type);
    expect(listed.sort()).toEqual(Object.values(PolicyType).sort());
  });

  it('should say which ones are city-wide and which need a district', () => {
    const byType = new Map(fakeHost().policy.list().map(p => [p.type, p]));

    expect(byType.get(CITY_WIDE)).toMatchObject({ scope: 'city' });
    expect(byType.get(PER_DISTRICT)).toMatchObject({ scope: 'district' });
  });

  it('should carry the maximum level each policy accepts', () => {
    const byType = new Map(fakeHost().policy.list().map(p => [p.type, p]));
    for (const t of Object.values(PolicyType)) {
      expect(byType.get(t)!.maxLevel, `${t} 的上限不對`).toBe(maxLevel(t));
    }
  });

  it('should leave district levels unknown until a district is named', () => {
    // 分區條例沒有「全城的等級」可言。回 0 的話會被讀成「已經查過，是關的」。
    const { policy } = fakeHost();
    const byType = new Map(policy.list().map(p => [p.type, p]));
    expect(byType.get(PER_DISTRICT)!.level, '沒指定分區卻報了一個等級').toBeNull();

    policy.setLevel(PER_DISTRICT, 1, 'd1');
    const named = new Map(policy.list('d1').map(p => [p.type, p]));
    expect(named.get(PER_DISTRICT)!.level).toBe(1);
  });
});

describe('開關條例', () => {
  it('should turn a city-wide ordinance on', () => {
    const { policy, host } = fakeHost();
    const r = policy.setLevel(CITY_WIDE, 1);

    expect(r).toMatchObject({ ok: true, scope: 'city', level: 1 });
    expect(host.cityLevel(CITY_WIDE)).toBe(1);
  });

  it('should turn a district policy on for the district it was told', () => {
    const { policy, host } = fakeHost();
    const r = policy.setLevel(PER_DISTRICT, 1, 'd1');

    expect(r).toMatchObject({ ok: true, scope: 'district', districtId: 'd1', level: 1 });
    expect(host.districtLevel('d1', PER_DISTRICT)).toBe(1);
  });

  it('should refuse a district id on a city-wide ordinance', () => {
    // 兩邊都設得進去的話效果會無聲地加倍，而費用只收一次。
    const { policy, host } = fakeHost();
    const r = policy.setLevel(CITY_WIDE, 1, 'd1');

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('city');
    expect(host.calls, '擋下來了卻還是設下去').toEqual([]);
  });

  it('should refuse a district policy with no district named', () => {
    const { policy, host } = fakeHost();
    const r = policy.setLevel(PER_DISTRICT, 1);

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('district');
    expect(host.calls).toEqual([]);
  });

  it('should name the district it could not find', () => {
    const { policy, host } = fakeHost();
    const r = policy.setLevel(PER_DISTRICT, 1, 'nowhere');

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('nowhere');
    expect(host.calls).toEqual([]);
  });

  it('should refuse a level above what the policy accepts', () => {
    // 核心會靜靜地夾。夾掉的話呼叫端會以為開到了它要的強度。
    const { policy, host } = fakeHost();
    const over = maxLevel(CITY_WIDE) + 1;
    const r = policy.setLevel(CITY_WIDE, over);

    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(maxLevel(CITY_WIDE)));
    expect(host.calls).toEqual([]);
  });

  it('should refuse a level that is not a whole number of steps', () => {
    const { policy, host } = fakeHost();

    expect(policy.setLevel(CITY_WIDE, -1).ok, '負的強度').toBe(false);
    expect(policy.setLevel(CITY_WIDE, 0.5).ok, '半級').toBe(false);
    expect(host.calls).toEqual([]);
  });

  it('should allow level zero to switch a policy off', () => {
    const { policy } = fakeHost();
    policy.setLevel(CITY_WIDE, 1);

    expect(policy.setLevel(CITY_WIDE, 0)).toMatchObject({ ok: true, level: 0 });
  });

  it('should refuse a policy type that does not exist', () => {
    const { policy, host } = fakeHost();
    const r = policy.setLevel('FREE_PIZZA' as PolicyType, 1);

    expect(r.ok).toBe(false);
    // 沒認出它是個不存在的條例的話，它會被當成分區條例，然後回一句
    // 「請指定分區」—— 那是在教呼叫端往錯的方向修。
    expect(r.reason, '沒說這個條例根本不存在').toContain('unknown');
    expect(host.calls).toEqual([]);
  });

  it('should not claim success when the game quietly ignored it', () => {
    // 這是這一層存在的理由。核心遇到不對的輸入不丟例外也不回值，只是 return。
    const { policy } = fakeHost({ setCityLevel: () => { /* 吃掉 */ } });
    const r = policy.setLevel(CITY_WIDE, 1);

    expect(r.ok, '遊戲根本沒設，卻回報成功').toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe('城市特化', () => {
  it('should list every specialization with what it takes and what it gives', () => {
    const s = fakeHost().policy.specializations();

    expect(s.current).toBe(CitySpecType.NONE);
    expect(s.options.map(o => o.type).sort()).toEqual(Object.values(CitySpecType).sort());
    expect(s.options.find(o => o.type === CitySpecType.TECH_CITY)).toMatchObject({
      requiredPopulation: 5000, available: true,
    });
  });

  it('should mark the ones the city is still too small for', () => {
    const { policy, host } = fakeHost();
    host.setPop(300);

    const s = policy.specializations();
    expect(s.population).toBe(300);
    expect(s.options.find(o => o.type === CitySpecType.TECH_CITY)!.available).toBe(false);
    expect(s.options.find(o => o.type === CitySpecType.NONE)!.available, '取消特化永遠做得到').toBe(true);
  });

  it('should choose one', () => {
    const { policy } = fakeHost();
    expect(policy.chooseSpecialization(CitySpecType.TECH_CITY)).toMatchObject({
      ok: true, current: CitySpecType.TECH_CITY,
    });
  });

  it('should say why a small city cannot specialize', () => {
    const { policy, host } = fakeHost();
    host.setPop(300);

    const r = policy.chooseSpecialization(CitySpecType.TECH_CITY);
    expect(r.ok).toBe(false);
    expect(r.reason, '沒說還差多少人').toContain('5000');
    expect(r.current).toBe(CitySpecType.NONE);
  });

  it('should refuse a specialization that does not exist', () => {
    const { policy, host } = fakeHost();
    expect(policy.chooseSpecialization('BANANA_CITY' as CitySpecType).ok).toBe(false);
    expect(host.calls).toEqual([]);
  });
});

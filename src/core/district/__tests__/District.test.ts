import { describe, it, expect, beforeEach } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_CONFIG, POLICY_ZONE_RESTRICTIONS } from '../PolicyManager';
import type { DistrictLookup } from '../PolicyManager';
import { setSpecialization, getSpecialization, getSpecializationBonus, SPECIALIZATION_BONUSES } from '../Specialization';
import { CitySpecialization, CitySpecType } from '../CitySpecialization';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { PolicyType, Specialization, type District } from '../types';
import { POLICY_BILLING, policyCost } from '../PolicyBilling';
import { ZoneType } from '../../grid/types';

describe('DistrictManager', () => {
  let dm: DistrictManager;

  beforeEach(() => {
    dm = new DistrictManager();
  });

  it('should create a district with a name', () => {
    const district = dm.createDistrict('Downtown');
    expect(district.id).toBeDefined();
    expect(district.name).toBe('Downtown');
    expect(district.cells.size).toBe(0);
    expect(district.policies).toEqual([]);
  });

  it('should add cells to a district', () => {
    const district = dm.createDistrict('Suburbs');
    dm.addCellToDistrict(district.id, 3, 5);
    dm.addCellToDistrict(district.id, 4, 5);
    const updated = dm.getDistrict(district.id);
    expect(updated!.cells.size).toBe(2);
    expect(updated!.cells.has('3,5')).toBe(true);
    expect(updated!.cells.has('4,5')).toBe(true);
  });

  it('should remove cells from a district', () => {
    const district = dm.createDistrict('Suburbs');
    dm.addCellToDistrict(district.id, 3, 5);
    dm.addCellToDistrict(district.id, 4, 5);
    dm.removeCellFromDistrict(district.id, 3, 5);
    const updated = dm.getDistrict(district.id);
    expect(updated!.cells.size).toBe(1);
    expect(updated!.cells.has('3,5')).toBe(false);
  });

  it('should get district at coordinate', () => {
    const d1 = dm.createDistrict('Zone A');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d1.id, 1, 2);

    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d2.id, 5, 5);

    expect(dm.getDistrictAt(1, 1)?.name).toBe('Zone A');
    expect(dm.getDistrictAt(5, 5)?.name).toBe('Zone B');
    expect(dm.getDistrictAt(9, 9)).toBeNull();
  });

  it('should rename a district', () => {
    const district = dm.createDistrict('Old Name');
    dm.renameDistrict(district.id, 'New Name');
    expect(dm.getDistrict(district.id)!.name).toBe('New Name');
  });

  it('should merge two districts', () => {
    const d1 = dm.createDistrict('Zone A');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d1.id, 1, 2);

    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d2.id, 3, 3);
    dm.addCellToDistrict(d2.id, 4, 4);

    const merged = dm.mergeDistricts(d1.id, d2.id);
    expect(merged.cells.size).toBe(4);
    expect(merged.cells.has('1,1')).toBe(true);
    expect(merged.cells.has('3,3')).toBe(true);
    // Second district should be removed
    expect(dm.getDistrict(d2.id)).toBeUndefined();
    // Merged keeps first district's name
    expect(merged.name).toBe('Zone A');
  });

  it('adding a cell to one district should remove it from others', () => {
    const d1 = dm.createDistrict('Zone A');
    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d1.id, 5, 5);
    expect(dm.getDistrictAt(5, 5)?.id).toBe(d1.id);

    // Move cell from d1 to d2
    dm.addCellToDistrict(d2.id, 5, 5);
    expect(dm.getDistrictAt(5, 5)?.id).toBe(d2.id);
    expect(dm.getDistrict(d1.id)!.cells.has('5,5')).toBe(false);
  });

  it('getDistrictAt returns null after cell removed', () => {
    const d = dm.createDistrict('Zone');
    dm.addCellToDistrict(d.id, 3, 3);
    expect(dm.getDistrictAt(3, 3)).not.toBeNull();
    dm.removeCellFromDistrict(d.id, 3, 3);
    expect(dm.getDistrictAt(3, 3)).toBeNull();
  });

  it('getDistrictAt returns correct district after merge', () => {
    const d1 = dm.createDistrict('Zone A');
    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d2.id, 2, 2);
    dm.mergeDistricts(d1.id, d2.id);
    expect(dm.getDistrictAt(2, 2)?.id).toBe(d1.id);
  });

  it('getDistrictAt returns correct district after split', () => {
    const d = dm.createDistrict('Big');
    dm.addCellToDistrict(d.id, 1, 1);
    dm.addCellToDistrict(d.id, 2, 2);
    const split = dm.splitDistrict(d.id, new Set(['2,2']));
    expect(dm.getDistrictAt(1, 1)?.id).toBe(d.id);
    expect(dm.getDistrictAt(2, 2)?.id).toBe(split.id);
  });

  it('should split a district into two', () => {
    const d = dm.createDistrict('Big Zone');
    dm.addCellToDistrict(d.id, 0, 0);
    dm.addCellToDistrict(d.id, 1, 1);
    dm.addCellToDistrict(d.id, 2, 2);
    dm.addCellToDistrict(d.id, 3, 3);

    const cellsForNewDistrict = new Set(['2,2', '3,3']);
    const newDistrict = dm.splitDistrict(d.id, cellsForNewDistrict);

    expect(newDistrict.cells.size).toBe(2);
    expect(newDistrict.cells.has('2,2')).toBe(true);
    expect(newDistrict.cells.has('3,3')).toBe(true);

    const original = dm.getDistrict(d.id);
    expect(original!.cells.size).toBe(2);
    expect(original!.cells.has('0,0')).toBe(true);
    expect(original!.cells.has('1,1')).toBe(true);
  });
});

describe('PolicyManager', () => {
  let dm: DistrictManager;
  let pm: PolicyManager;

  beforeEach(() => {
    dm = new DistrictManager();
    pm = new PolicyManager(dm);
  });

  it('should apply a policy to a district', () => {
    const district = dm.createDistrict('Test');
    pm.setPolicyLevel(district.id, PolicyType.NO_HEAVY_INDUSTRY, 1);
    expect(pm.isPolicyActive(district.id, PolicyType.NO_HEAVY_INDUSTRY)).toBe(true);
  });

  it('should remove a policy from a district', () => {
    const district = dm.createDistrict('Test');
    pm.setPolicyLevel(district.id, PolicyType.ENCOURAGE_RECYCLING, 1);
    pm.removePolicy(district.id, PolicyType.ENCOURAGE_RECYCLING);
    expect(pm.isPolicyActive(district.id, PolicyType.ENCOURAGE_RECYCLING)).toBe(false);
  });

  it('should return false for inactive policy', () => {
    const district = dm.createDistrict('Test');
    expect(pm.isPolicyActive(district.id, PolicyType.TOURISM)).toBe(false);
  });

  it('NO_HEAVY_INDUSTRY should block industrial buildings', () => {
    const district = dm.createDistrict('Clean Zone');
    pm.setPolicyLevel(district.id, PolicyType.NO_HEAVY_INDUSTRY, 1);
    expect(pm.canBuildInDistrict(district.id, ZoneType.INDUSTRIAL)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_LOW)).toBe(true);
  });

  it('HIGH_DENSITY_BAN should block high density zones', () => {
    const district = dm.createDistrict('Low Rise');
    pm.setPolicyLevel(district.id, PolicyType.HIGH_DENSITY_BAN, 1);
    expect(pm.canBuildInDistrict(district.id, ZoneType.RESIDENTIAL_HIGH)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_HIGH)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.RESIDENTIAL_LOW)).toBe(true);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_LOW)).toBe(true);
  });

  it('POLICY_ZONE_RESTRICTIONS table drives canBuildInDistrict (OCP)', () => {
    const district = dm.createDistrict('Test');
    // Verify each restriction entry blocks the right zones
    for (const [policyType, blockedZones] of Object.entries(POLICY_ZONE_RESTRICTIONS)) {
      pm.setPolicyLevel(district.id, policyType as PolicyType, 1);
      for (const zone of blockedZones!) {
        expect(pm.canBuildInDistrict(district.id, zone)).toBe(false);
      }
      pm.removePolicy(district.id, policyType as PolicyType);
    }
  });

  it('POLICY_CONFIG should name every PolicyType', () => {
    // 價錢已經不在這張表上 —— 它跟著規模走，由 POLICY_BILLING 算。這裡只剩名字，
    // 而名字是 UI 唯一的來源，缺一個就會在畫面上看到 enum 的原字串。
    for (const policyType of Object.values(PolicyType)) {
      const cfg = POLICY_CONFIG[policyType];
      expect(cfg, `${policyType} 沒有設定`).toBeDefined();
      expect(cfg.name, `${policyType} 沒有名字`).toBeTruthy();
    }
    // 名字必須各不相同 —— 全部叫同一個字也會通過「有名字」，但玩家看到的是五顆
    // 一模一樣的按鈕。
    const names = Object.values(PolicyType).map(t => POLICY_CONFIG[t].name);
    expect(new Set(names).size, `有兩條條例同名:${names.join(', ')}`).toBe(names.length);
  });

  it('should charge a scale-dependent price for every billable policy', () => {
    // 取代舊的「每條政策都有一個正數價錢」。限制型條例現在刻意不收費，所以那個
    // 問法已經不成立 —— 改成問:凡是列了計費基數的，價錢就必須跟著規模動。
    // 每一個計費基數都要給值。漏掉一個的話，用那個基數的條例會恆為 0，而這條
    // 測試會把它讀成「這條條例不收錢」而紅 —— 那是對的，加基數就要補這裡。
    const small = scaleOf({
      population: 100, districtCells: 10, districtRoadCells: 4,
      babies: 4, children: 6, teens: 5, clinicPatients: 90, chargedDrivers: 12,
    });
    const big = scaleOf({
      population: 10_000, districtCells: 400, districtRoadCells: 160,
      babies: 400, children: 600, teens: 500, clinicPatients: 9_000, chargedDrivers: 1_200,
    });
    const billable = Object.keys(POLICY_BILLING) as PolicyType[];
    expect(billable.length, '沒有任何條例收費，這條測試等於空轉').toBeGreaterThan(0);
    for (const type of billable) {
      expect(policyCost(type, 1, small), `${type} 在小規模下不收錢`).toBeGreaterThan(0);
      expect(policyCost(type, 1, big), `${type} 的費用不隨規模變動`)
        .toBeGreaterThan(policyCost(type, 1, small));
    }
  });

  it('separate PolicyManager instances should have independent ID counters', () => {
    const dm2 = new DistrictManager();
    const pm2 = new PolicyManager(dm2);
    const d1 = dm.createDistrict('A');
    const d2 = dm2.createDistrict('B');
    pm.setPolicyLevel(d1.id, PolicyType.TOURISM, 1);
    pm2.setPolicyLevel(d2.id, PolicyType.TOURISM, 1);
    // Both should start from 1 independently
    expect(d1.policies[0]!.id).toMatch(/^policy_1$/);
    expect(d2.policies[0]!.id).toMatch(/^policy_1$/);
  });

  it('should work with a mock DistrictLookup (DIP)', () => {
    const mockDistrict: District = {
      id: 'mock_1',
      name: 'Mock District',
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };
    const mockLookup: DistrictLookup = {
      getDistrict: (id: string) => (id === 'mock_1' ? mockDistrict : undefined),
    };
    const mockPm = new PolicyManager(mockLookup);
    mockPm.setPolicyLevel('mock_1', PolicyType.TOURISM, 1);
    expect(mockPm.isPolicyActive('mock_1', PolicyType.TOURISM)).toBe(true);
    expect(mockPm.isPolicyActive('nonexistent', PolicyType.TOURISM)).toBe(false);
  });
});

describe('Specialization', () => {
  let dm: DistrictManager;

  beforeEach(() => {
    dm = new DistrictManager();
  });

  it('should default to NONE specialization', () => {
    const district = dm.createDistrict('Default');
    expect(getSpecialization(dm, district.id)).toBe(Specialization.NONE);
  });

  it('should set specialization on a district', () => {
    const district = dm.createDistrict('Farm District');
    setSpecialization(dm, district.id, Specialization.FARMING);
    expect(getSpecialization(dm, district.id)).toBe(Specialization.FARMING);
  });

  it('should return bonuses for specializations', () => {
    const farmBonus = getSpecializationBonus(Specialization.FARMING);
    expect(farmBonus.efficiencyMultiplier).toBeGreaterThan(1);
    expect(farmBonus.revenueMultiplier).toBeGreaterThanOrEqual(1);

    const noneBonus = getSpecializationBonus(Specialization.NONE);
    expect(noneBonus.efficiencyMultiplier).toBe(1);
    expect(noneBonus.revenueMultiplier).toBe(1);
  });

  it('should provide different bonuses for different specializations', () => {
    const highTech = getSpecializationBonus(Specialization.HIGH_TECH);
    const mining = getSpecializationBonus(Specialization.MINING);
    // Both should have bonuses but they may differ
    expect(highTech.efficiencyMultiplier).toBeGreaterThan(1);
    expect(mining.efficiencyMultiplier).toBeGreaterThan(1);
  });

  it('SPECIALIZATION_BONUSES should have entry for every Specialization enum value', () => {
    const allSpecs = Object.values(Specialization).filter(v => typeof v === 'number') as Specialization[];
    for (const spec of allSpecs) {
      expect(SPECIALIZATION_BONUSES[spec]).toBeDefined();
      expect(SPECIALIZATION_BONUSES[spec].efficiencyMultiplier).toBeGreaterThanOrEqual(1);
      expect(SPECIALIZATION_BONUSES[spec].revenueMultiplier).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('CitySpecialization', () => {
  let cs: CitySpecialization;

  beforeEach(() => {
    cs = new CitySpecialization();
  });

  it('should default to NONE', () => {
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
    expect(cs.getBonus().revenueMultiplier).toBe(1);
  });

  it('should require population to choose a specialization', () => {
    expect(cs.canChoose(CitySpecType.MINING_CITY, 1000)).toBe(false);
    expect(cs.canChoose(CitySpecType.MINING_CITY, 5000)).toBe(true);
  });

  it('should fail to choose if population too low', () => {
    const result = cs.choose(CitySpecType.TECH_CITY, 2000);
    expect(result).toBe(false);
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
  });

  it('MINING_CITY: revenue boost + negative happiness + crime', () => {
    cs.choose(CitySpecType.MINING_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBeGreaterThan(1);
    expect(bonus.happinessModifier).toBeLessThan(0);
    expect(bonus.crimeModifier).toBeGreaterThan(0);
  });

  it('TECH_CITY: revenue boost + positive happiness + low crime', () => {
    cs.choose(CitySpecType.TECH_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBeGreaterThan(1);
    expect(bonus.happinessModifier).toBeGreaterThan(0);
    expect(bonus.crimeModifier).toBeLessThan(0);
  });

  it('TOURISM_CITY: revenue boost + positive happiness', () => {
    cs.choose(CitySpecType.TOURISM_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBe(1.2);
    expect(bonus.happinessModifier).toBeGreaterThan(0);
  });

  it('GAMBLING_CITY: high revenue but high crime and low happiness', () => {
    cs.choose(CitySpecType.GAMBLING_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBe(1.4);
    expect(bonus.happinessModifier).toBeLessThan(0);
    expect(bonus.crimeModifier).toBeGreaterThanOrEqual(15);
  });

  it('should allow choosing NONE without population requirement', () => {
    cs.choose(CitySpecType.MINING_CITY, 5000);
    expect(cs.getCurrent()).toBe(CitySpecType.MINING_CITY);
    cs.choose(CitySpecType.NONE, 0);
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
  });
});

describe('色票與名字的存檔往返', () => {
  it('should carry the colour and the name through a save', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('Riverside');
    dm.setDistrictColor(d.id, 3);
    const back = DistrictManager.fromJSON(dm.toJSON());
    const r = back.getDistrict(d.id)!;
    expect(r.name).toBe('Riverside');
    expect(r.colorIndex, '選過的顏色讀檔之後不見了').toBe(3);
  });

  it('should drop a colour index a hand-edited save could not have', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('A');
    const json = dm.toJSON();
    json.districts[0]!.colorIndex = 999;
    const back = DistrictManager.fromJSON(json);
    expect(back.getDistrict(d.id)!.colorIndex,
      '壞掉的索引留了下來，那一區會從圖層上消失').toBeUndefined();
  });

  it('should refuse a broken index at the setter too', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('A');
    dm.setDistrictColor(d.id, 2);
    dm.setDistrictColor(d.id, -1);
    expect(dm.getDistrict(d.id)!.colorIndex).toBeUndefined();
  });
});

describe('刪掉一個分區', () => {
  /**
   * 玩家可以把一區的格子扣光。那個分區會留下來（它身上的條例設定不該因為擦掉一次
   * 就消失），但留下來就得有辦法清掉 —— 不然條例面板的側邊欄會慢慢積滿再也碰不到
   * 的名字。
   */
  it('should take the district off the list', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.createDistrict('B');
    dm.deleteDistrict(a.id);
    expect(dm.getDistrict(a.id)).toBeUndefined();
    expect(dm.getAllDistricts().map(d => d.name), 'B 也被掃到了').toEqual(['B']);
  });

  it('should hand its cells back to nobody', () => {
    // 刪掉一區之後，它的格子要變回無主的 —— 筆刷的點選與分區條例的逐格查詢走的
    // 都是 `getDistrictAt`。
    //
    // 注意這條**守不到** `deleteDistrict` 裡清索引的那個迴圈:`getDistrictAt` 自己
    // 有 `?? null`，索引留著髒資料它也照樣回 null。那個迴圈是維持「逐格索引是純
    // 衍生狀態」這個不變式，不是這裡的行為靠著它。
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.addCellToDistrict(a.id, 3, 4);
    dm.deleteDistrict(a.id);
    expect(dm.getDistrictAt(3, 4), '格子還指著被刪掉的分區').toBeNull();
  });

  it('should let another district claim those cells afterwards', () => {
    // 上一條只驗了查詢，這條驗寫入。同樣守不到清索引的迴圈 ——
    // `addCellToDistrict` 對舊主人用的是 `?.`。
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.addCellToDistrict(a.id, 3, 4);
    dm.deleteDistrict(a.id);
    const b = dm.createDistrict('B');
    dm.addCellToDistrict(b.id, 3, 4);
    expect(dm.getDistrictAt(3, 4)?.id).toBe(b.id);
  });

  it('should leave other districts alone', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    const b = dm.createDistrict('B');
    dm.addCellToDistrict(a.id, 0, 0);
    dm.addCellToDistrict(b.id, 1, 1);
    dm.deleteDistrict(a.id);
    expect(dm.getDistrictAt(1, 1)?.id, 'B 的格子跟著被清掉了').toBe(b.id);
  });

  it('should do nothing for an id that is not there', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.addCellToDistrict(a.id, 0, 0);
    expect(() => dm.deleteDistrict('district_999')).not.toThrow();
    expect(dm.getAllDistricts().length).toBe(1);
    expect(dm.getDistrictAt(0, 0)?.id).toBe(a.id);
  });

  it('should not come back after a save round-trip', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.createDistrict('B');
    dm.deleteDistrict(a.id);
    const back = DistrictManager.fromJSON(dm.toJSON());
    expect(back.getAllDistricts().map(d => d.name)).toEqual(['B']);
  });
});

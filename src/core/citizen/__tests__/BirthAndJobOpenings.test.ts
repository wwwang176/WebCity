import { describe, it, expect, vi, afterEach } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { birthTick } from '../Birth';
import { LifeStage } from '../types';

/**
 * Two model defects with the same shape: a headline number standing in for a
 * question it does not answer.
 *
 *  - createCitizen's capacity gate compares the whole citizen list against
 *    total residential capacity. That list includes citizens with no home, so a
 *    city carrying any homeless population reported itself full while real
 *    rooms stood empty. Births run once a MONTH against migration's once every
 *    6 ticks, so births were always the ones turned away and natural birth
 *    degenerated into a residual mechanism.
 *  - countJobOpenings subtracted the whole POPULATION from total jobs, counting
 *    every baby, schoolchild and retiree as an occupied desk.
 */
const HOUSE_CAPACITY = 4;
const ctx = { getResidents: () => HOUSE_CAPACITY };

/** n fertile adults spread one per house, each house with room to spare. */
function adultsInHouses(mgr: CitizenManager, n: number): void {
  for (let i = 0; i < n; i++) {
    const c = mgr.createCitizenInKnownVacancy({ age: 100 });
    c.homeId = `${i},0`;
    c.happiness = 80;
  }
}

describe('births use the room their own house has', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('should produce children when every house has space', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = new CitizenManager();
    adultsInHouses(mgr, 5);
    mgr.updateResidentialCapacity(5 * HOUSE_CAPACITY);

    // Assert the citizens exist, not just the reported count: the old loop
    // incremented `births` from a create call whose null return it checked
    // separately, so a broken create could still report a number.
    expect(birthTick(mgr, ctx)).toBe(5);
    expect(mgr.getCitizens().filter(c => c.age === 0)).toHaveLength(5);
  });

  it('should still produce children while the city carries homeless citizens', () => {
    // 5 houses x 4 = 20 places. 5 adults at home, 15 homeless — the aggregate
    // gate saw 20 citizens against 20 capacity and refused every birth, even
    // though each house held exactly one person.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = new CitizenManager();
    adultsInHouses(mgr, 5);
    for (let i = 0; i < 15; i++) mgr.createCitizenInKnownVacancy({ age: 100 });
    mgr.updateResidentialCapacity(5 * HOUSE_CAPACITY);

    expect(birthTick(mgr, ctx)).toBe(5);
    expect(mgr.getCitizens().filter(c => c.age === 0)).toHaveLength(5);
  });

  it('should still refuse a birth in a house that is genuinely full', () => {
    // Negative control: the per-building check is the one doing the work, and
    // bypassing the aggregate gate must not bypass that.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = new CitizenManager();
    for (let i = 0; i < HOUSE_CAPACITY; i++) {
      const c = mgr.createCitizenInKnownVacancy({ age: 100 });
      c.homeId = '0,0';
    }
    mgr.updateResidentialCapacity(1000);

    expect(birthTick(mgr, ctx)).toBe(0);
    expect(mgr.getCitizens().filter(c => c.age === 0)).toHaveLength(0);
  });

  it('should never push a house past its own capacity in one tick', () => {
    // Three fertile adults in a 4-person house: room for exactly ONE more.
    //
    // Two adults in a 4-person house cannot overfill it however the code
    // behaves — there is room for two and at most two can be born — so that
    // version passed with the running occupancy increment deleted. The number
    // of would-be parents has to EXCEED the free rooms for the increment to be
    // the thing under test.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = new CitizenManager();
    for (let i = 0; i < HOUSE_CAPACITY - 1; i++) {
      const c = mgr.createCitizenInKnownVacancy({ age: 100 });
      c.homeId = '0,0';
    }
    mgr.updateResidentialCapacity(1000);

    expect(birthTick(mgr, ctx), 'exactly one room, so exactly one baby').toBe(1);

    const inHouse = mgr.getCitizens().filter(c => c.homeId === '0,0').length;
    expect(inHouse).toBe(HOUSE_CAPACITY);
  });
});

describe('employment is counted by held jobs, not by headcount', () => {
  it('should count only citizens holding a workplace', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    for (let i = 0; i < 10; i++) mgr.createCitizen({ age: 100 })!;
    for (const c of mgr.getCitizens().slice(0, 4)) c.workplaceId = '1,1';

    expect(mgr.getPopulation()).toBe(10);
    expect(mgr.getEmployedCount()).toBe(4);
  });

  it('should count a citizen who holds a job regardless of age', () => {
    // The old version of this case was called "should not count children and
    // retirees as employed" and created three citizens with no workplaceId at
    // all. getEmployedCount has no age logic whatsoever, so it asserted nothing
    // about age — it would have passed for an implementation that counted
    // retirees, which is the claim it was named for. The
    // `.map(c => c.lifeStage)).not.toContain(undefined)` line was likewise
    // unfalsifiable: getLifeStage is total.
    //
    // What getEmployedCount actually promises is "holds a workplaceId", and
    // that is what is pinned. Whether a child can hold one is
    // assignWorkWithPreference's business, and EvictionAndRetirement covers
    // retirement releasing the field.
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    const baby = mgr.createCitizen({ age: 4 })!;
    const child = mgr.createCitizen({ age: 20 })!;
    const retiree = mgr.createCitizen({ age: 260 })!;
    expect(mgr.getEmployedCount()).toBe(0);

    retiree.workplaceId = '1,1';
    expect(mgr.getEmployedCount(), 'a held job is a held job').toBe(1);

    baby.workplaceId = '1,1';
    child.workplaceId = '1,1';
    expect(mgr.getEmployedCount()).toBe(3);
  });

  it('should drop back to zero when everyone is laid off', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    for (let i = 0; i < 5; i++) mgr.createCitizen({ age: 100, workplaceId: '2,2' })!;
    expect(mgr.getEmployedCount()).toBe(5);

    for (const c of mgr.getCitizens()) c.workplaceId = null;

    expect(mgr.getEmployedCount()).toBe(0);
  });

  it('should keep BABY out of the workforce even if lifeStage is derived', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    const baby = mgr.createCitizen({ age: 0 })!;
    expect(baby.lifeStage).toBe(LifeStage.BABY);
    expect(mgr.getEmployedCount()).toBe(0);
  });
});

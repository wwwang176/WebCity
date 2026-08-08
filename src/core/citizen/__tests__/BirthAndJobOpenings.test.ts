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
    // Two adults in a 4-person house: room for exactly 2 more, and the babies
    // must not exceed that even though both parents roll a birth.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = new CitizenManager();
    for (let i = 0; i < 2; i++) {
      const c = mgr.createCitizenInKnownVacancy({ age: 100 });
      c.homeId = '0,0';
    }
    mgr.updateResidentialCapacity(1000);

    birthTick(mgr, ctx);

    const inHouse = mgr.getCitizens().filter(c => c.homeId === '0,0').length;
    expect(inHouse).toBeLessThanOrEqual(HOUSE_CAPACITY);
  });
});

describe('employment is counted by held jobs, not by headcount', () => {
  it('should count only citizens holding a workplace', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    for (let i = 0; i < 10; i++) mgr.createCitizen({ age: 100 });
    for (const c of mgr.getCitizens().slice(0, 4)) c.workplaceId = '1,1';

    expect(mgr.getPopulation()).toBe(10);
    expect(mgr.getEmployedCount()).toBe(4);
  });

  it('should not count children and retirees as employed', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    mgr.createCitizen({ age: 4 });    // BABY
    mgr.createCitizen({ age: 20 });   // CHILD
    mgr.createCitizen({ age: 260 });  // past ADULT_MAX
    expect(mgr.getCitizens().map(c => c.lifeStage)).not.toContain(undefined);

    expect(mgr.getEmployedCount()).toBe(0);
  });

  it('should drop back to zero when everyone is laid off', () => {
    const mgr = new CitizenManager();
    mgr.updateResidentialCapacity(1000);
    for (let i = 0; i < 5; i++) mgr.createCitizen({ age: 100, workplaceId: '2,2' });
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

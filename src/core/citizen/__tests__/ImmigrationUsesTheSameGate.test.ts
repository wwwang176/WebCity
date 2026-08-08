import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { migrationTick } from '../Migration';

/**
 * BUG-140 fixed the birth path: createCitizen's aggregate gate counts citizens
 * who have no home at all, so any homeless population made the city report
 * itself full while real rooms stood empty, and births were refused. birthTick
 * already verifies the destination building's own occupancy, which is the
 * stronger check, so it was routed past the aggregate one.
 *
 * Immigration does exactly the same thing — it builds a vacancy list, picks a
 * slot with room for the whole family, and only then creates the citizens — and
 * was left on the old gate. So the once-a-month path was fixed and the
 * once-every-six-ticks path was not (BUG-165).
 *
 * The two then disagree about what "full" means. Births push citizens.length up
 * against a capacity immigration still measures against the whole list, so
 * `!citizen` sets familySettled = false and breaks — after slots[idx].occupied
 * has already been advanced by the full family size. Immigration dies mid-family
 * for the tick, and countVacantHomes floors at 0, which simultaneously fails the
 * `vacantHomes > 0` gate and costs the city ATTRACTIVENESS.VACANT_SCORE.
 */
const CITY = {
  jobOpenings: 200, vacantHomes: 40, avgHappiness: 85, taxRate: 5,
  pollution: 0, crimeRate: 0, unemploymentRate: 0, hasUniversity: false,
  officeRatio: 0, industrialRatio: 0, avgLandValue: 60,
};

/** A city with room for 40 and a stated capacity to match. */
function manager(capacity: number, homeless: number): CitizenManager {
  const m = new CitizenManager();
  m.updateResidentialCapacity(capacity);
  for (let i = 0; i < homeless; i++) {
    m.createCitizenInKnownVacancy({ age: 150, homeId: null }, 0);
  }
  return m;
}

const roomFor = (n: number) => [{ pos: '5,5', capacity: n, occupied: 0 }];

describe('immigration is gated on the room it found, not on the whole city', () => {
  it('should settle families into a vacancy that has room', () => {
    const m = manager(40, 0);
    migrationTick(m, CITY, m.getPopulation(), 0, roomFor(20));
    expect(m.getPopulation()).toBeGreaterThan(0);
  });

  it('should still move people in while the city carries homeless', () => {
    // The defect. The vacancy is real and has room; the aggregate gate refused
    // because the homeless already counted toward the capacity.
    const m = manager(20, 20);
    const before = m.getPopulation();
    migrationTick(m, CITY, m.getPopulation(), 0, roomFor(20));
    expect(m.getPopulation()).toBeGreaterThan(before);
  });

  it('should never put more people in a home than it holds', () => {
    // The check that replaces the aggregate one, and it has to actually hold.
    const m = manager(0, 0);
    const slots = roomFor(3);
    migrationTick(m, CITY, m.getPopulation(), 0, slots);
    const atHome = m.getCitizens().filter(c => c.homeId === '5,5').length;
    expect(atHome).toBeLessThanOrEqual(3);
  });

  it('should refuse to move anyone in when no vacancy has room', () => {
    const m = manager(100, 0);
    const before = m.getPopulation();
    migrationTick(m, CITY, m.getPopulation(), 0, []);
    expect(m.getPopulation()).toBe(before);
  });

  it('should refuse when every vacancy is already full', () => {
    const m = manager(100, 0);
    const before = m.getPopulation();
    migrationTick(m, CITY, m.getPopulation(), 0, [{ pos: '5,5', capacity: 4, occupied: 4 }]);
    expect(m.getPopulation()).toBe(before);
  });

  it('should spread across several vacancies without overfilling any', () => {
    const m = manager(0, 0);
    const slots = [
      { pos: '1,1', capacity: 4, occupied: 0 },
      { pos: '2,2', capacity: 4, occupied: 0 },
      { pos: '3,3', capacity: 4, occupied: 0 },
    ];
    migrationTick(m, CITY, m.getPopulation(), 0, slots);

    for (const s of slots) {
      const atHome = m.getCitizens().filter(c => c.homeId === s.pos).length;
      expect(atHome, s.pos).toBeLessThanOrEqual(s.capacity);
    }
  });
});

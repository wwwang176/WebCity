import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { buildDemographicsStats, WORK_KEYS } from '../DemographicsStats';
import { EducationLevel, LifeStage } from '../../citizen/types';
import { ZoneType } from '../../grid/types';

/** An adult living at `home` and working at `work`. */
function adult(state: GameState, over: {
  education?: string; homeId?: string | null; workplaceId?: string | null;
  happiness?: number; health?: number;
} = {}) {
  const c = state.citizens.restoreCitizen({
    age: 100,
    education: (over.education ?? EducationLevel.NONE) as never,
  });
  c.homeId = over.homeId ?? null;
  c.workplaceId = over.workplaceId ?? null;
  if (over.happiness !== undefined) c.happiness = over.happiness;
  if (over.health !== undefined) c.health = over.health;
  if (c.workplaceId === null) c.unemployedSince = 0;
  return c;
}

describe('人口組成', () => {
  it('should divide employment by adults, not by everyone', () => {
    // Babies are not unemployed. With total population as the denominator, a young city looks
    // permanently on the brink of collapse.
    const state = createGameState(8, 8);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });
    adult(state, { workplaceId: '2,2' });
    const baby = state.citizens.restoreCitizen({ age: 1 });
    baby.workplaceId = null;

    const s = buildDemographicsStats(state);

    expect(s.population, '嬰兒沒被算進人口').toBe(2);
    expect(s.adults, '嬰兒被當成成年人了').toBe(1);
    expect(s.employmentRate, '分母用了總人口').toBe(1);
  });

  it('should not call a newborn adult unemployed before they ever looked', () => {
    // `unemployedSince === null` means the search has not started; counting it inflates
    // unemployment.
    const state = createGameState(8, 8);
    const c = state.citizens.restoreCitizen({ age: 100 });
    c.workplaceId = null;
    c.unemployedSince = null;

    const s = buildDemographicsStats(state);

    expect(s.adults).toBe(1);
    expect(s.unemployed, '還沒找過工作就被算成失業').toBe(0);
  });

  it('should still put that adult in the unemployed column of the cross-table', () => {
    // The cross-tab answers "what are these people doing"; no job is no job, whether or not
    // they ever looked.
    const state = createGameState(8, 8);
    const c = state.citizens.restoreCitizen({ age: 100 });
    c.workplaceId = null;
    c.unemployedSince = null;

    const row = buildDemographicsStats(state).educationByWork
      .find(r => r.education === String(EducationLevel.NONE))!;

    expect(row.counts[WORK_KEYS.indexOf('unemployed')]).toBe(1);
  });

  it('should file each worker under the zone they actually work in', () => {
    const state = createGameState(8, 8);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });
    state.grid.setCell(3, 3, { zoneType: ZoneType.OFFICE, buildingId: 1 });
    adult(state, { workplaceId: '2,2' });
    adult(state, { workplaceId: '3,3' });

    const s = buildDemographicsStats(state);

    expect(s.workZones.find(b => b.key === 'industrial')!.count).toBe(1);
    expect(s.workZones.find(b => b.key === 'office')!.count).toBe(1);
    expect(s.workers).toBe(2);
  });

  it('should cross education against where people work', () => {
    // "300 university graduates" does not show whether the education spending paid off;
    // "210 of them in industry" does.
    const state = createGameState(8, 8);
    state.grid.setCell(2, 2, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });
    adult(state, { education: EducationLevel.UNIVERSITY, workplaceId: '2,2' });

    const row = buildDemographicsStats(state).educationByWork
      .find(r => r.education === String(EducationLevel.UNIVERSITY))!;

    expect(row.counts[WORK_KEYS.indexOf('industrial')]).toBe(1);
    expect(row.total).toBe(1);
  });

  it('should give every education level a row even when nobody is in it', () => {
    // A table with rows missing leaves the reader guessing between "0" and "not collected".
    const s = buildDemographicsStats(createGameState(4, 4));

    expect(s.educationByWork).toHaveLength(4);
    expect(s.educationByHousing).toHaveLength(4);
    expect(s.educationByWork.every(r => r.total === 0)).toBe(true);
  });

  it('should not count a homeless citizen towards any housing level', () => {
    const state = createGameState(8, 8);
    adult(state, { homeId: null });

    expect(buildDemographicsStats(state).withHome).toBe(0);
  });

  it('should average happiness and health over everyone, zero when empty', () => {
    const empty = buildDemographicsStats(createGameState(4, 4));
    expect(empty.avgHappiness).toBe(0);
    expect(empty.avgHealth).toBe(0);

    const state = createGameState(8, 8);
    adult(state, { happiness: 40 });
    adult(state, { happiness: 80 });

    expect(buildDemographicsStats(state).avgHappiness).toBe(60);
  });

  it('should keep the life-stage buckets in the order the panel draws them', () => {
    // The panel draws a left-to-right distribution bar. Reorder it and the caller's "leftmost
    // segment" is no longer the one the player sees.
    const s = buildDemographicsStats(createGameState(4, 4));

    expect(s.lifeStages.map(b => b.key)).toEqual([
      LifeStage.BABY, LifeStage.CHILD, LifeStage.TEEN, LifeStage.ADULT, LifeStage.SENIOR,
    ].map(String));
  });
});

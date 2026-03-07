import { describe, it, expect } from 'vitest';
import { getMilestone, isUnlocked, getNextMilestone, MILESTONES } from '../Milestone';
import {
  GreatWorkType,
  canStart,
  startConstruction,
  tickConstruction,
  getCompletionBuff,
} from '../GreatWorks';

describe('Milestone', () => {
  it('should NOT unlock fire_service at population 499', () => {
    expect(isUnlocked('fire_service', 499)).toBe(false);
  });

  it('should unlock fire_service at population 500', () => {
    expect(isUnlocked('fire_service', 500)).toBe(true);
  });

  it('should unlock high_density at population 1000', () => {
    expect(isUnlocked('high_density', 1000)).toBe(true);
  });

  it('should unlock police at population 500', () => {
    expect(isUnlocked('police', 500)).toBe(true);
  });

  it('should unlock metro at population 1000', () => {
    expect(isUnlocked('metro', 1000)).toBe(true);
  });

  it('should NOT unlock metro at population 999', () => {
    expect(isUnlocked('metro', 999)).toBe(false);
  });

  it('should return highest achieved milestone', () => {
    const m = getMilestone(1500);
    expect(m).toBeDefined();
    expect(m!.populationRequired).toBe(1000);
  });

  it('should return null for population 0', () => {
    const m = getMilestone(0);
    expect(m).toBeNull();
  });

  it('getNextMilestone for population 700 should return 1000 milestone', () => {
    const next = getNextMilestone(700);
    expect(next).toBeDefined();
    expect(next!.populationRequired).toBe(1000);
  });

  it('getNextMilestone for population >= 25000 should return null', () => {
    const next = getNextMilestone(25000);
    expect(next).toBeNull();
  });

  it('should have correct milestone structure', () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(6);
    for (const m of MILESTONES) {
      expect(m.id).toBeDefined();
      expect(m.name).toBeDefined();
      expect(m.populationRequired).toBeGreaterThan(0);
      expect(Array.isArray(m.unlocks)).toBe(true);
    }
  });
});

describe('GreatWorks', () => {
  it('should NOT start without enough funds', () => {
    expect(canStart(GreatWorkType.SPACE_CENTER, 20000, 100)).toBe(false);
  });

  it('should NOT start without enough population', () => {
    expect(canStart(GreatWorkType.SPACE_CENTER, 100, 100000)).toBe(false);
  });

  it('should start when requirements are met', () => {
    expect(canStart(GreatWorkType.SPACE_CENTER, 10000, 50000)).toBe(true);
  });

  it('should create great work in building status', () => {
    const work = startConstruction(GreatWorkType.SPACE_CENTER);
    expect(work.type).toBe(GreatWorkType.SPACE_CENTER);
    expect(work.status).toBe('building');
    expect(work.currentBuildTicks).toBe(0);
    expect(work.buildTicks).toBe(100);
    expect(work.requiredFunds).toBe(50000);
    expect(work.requiredPopulation).toBe(10000);
  });

  it('should advance construction by 1 tick', () => {
    let work = startConstruction(GreatWorkType.SPACE_CENTER);
    work = tickConstruction(work);
    expect(work.currentBuildTicks).toBe(1);
    expect(work.status).toBe('building');
  });

  it('should complete construction after enough ticks', () => {
    let work = startConstruction(GreatWorkType.MEGA_STADIUM);
    for (let i = 0; i < 50; i++) {
      work = tickConstruction(work);
    }
    expect(work.currentBuildTicks).toBe(50);
    expect(work.status).toBe('completed');
  });

  it('completed SPACE_CENTER should give happiness +10', () => {
    const buff = getCompletionBuff(GreatWorkType.SPACE_CENTER);
    expect(buff.happinessBonus).toBe(10);
  });

  it('completed MEGA_STADIUM should give tourist +50%', () => {
    const buff = getCompletionBuff(GreatWorkType.MEGA_STADIUM);
    expect(buff.touristBonus).toBe(0.5);
  });

  it('MEGA_STADIUM requires 30000 funds and 5000 pop', () => {
    expect(canStart(GreatWorkType.MEGA_STADIUM, 5000, 30000)).toBe(true);
    expect(canStart(GreatWorkType.MEGA_STADIUM, 4999, 30000)).toBe(false);
    expect(canStart(GreatWorkType.MEGA_STADIUM, 5000, 29999)).toBe(false);
  });

  it('should not advance ticks past completion', () => {
    let work = startConstruction(GreatWorkType.MEGA_STADIUM);
    for (let i = 0; i < 60; i++) {
      work = tickConstruction(work);
    }
    expect(work.currentBuildTicks).toBe(50);
    expect(work.status).toBe('completed');
  });
});

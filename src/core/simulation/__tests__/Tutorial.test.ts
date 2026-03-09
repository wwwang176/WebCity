import { describe, it, expect } from 'vitest';
import { Tutorial, type TutorialStep } from '../../tutorial/Tutorial';

describe('Tutorial', () => {
  it('should initialize with steps and start at step 0', () => {
    const tut = new Tutorial();
    expect(tut.getCurrentStep()).toBeDefined();
    expect(tut.getStepIndex()).toBe(0);
    expect(tut.isActive()).toBe(true);
  });

  it('should advance to next step', () => {
    const tut = new Tutorial();
    const first = tut.getCurrentStep();
    tut.next();
    const second = tut.getCurrentStep();
    expect(second).toBeDefined();
    expect(tut.getStepIndex()).toBe(1);
    expect(first!.title).not.toBe(second!.title);
  });

  it('should go back to previous step', () => {
    const tut = new Tutorial();
    tut.next();
    tut.next();
    expect(tut.getStepIndex()).toBe(2);
    tut.prev();
    expect(tut.getStepIndex()).toBe(1);
  });

  it('should not go below step 0', () => {
    const tut = new Tutorial();
    tut.prev();
    expect(tut.getStepIndex()).toBe(0);
  });

  it('should mark as complete when past last step', () => {
    const tut = new Tutorial();
    const totalSteps = tut.getTotalSteps();
    for (let i = 0; i < totalSteps; i++) {
      tut.next();
    }
    expect(tut.isActive()).toBe(false);
    expect(tut.isComplete()).toBe(true);
    expect(tut.getCurrentStep()).toBeNull();
  });

  it('should be dismissable', () => {
    const tut = new Tutorial();
    tut.dismiss();
    expect(tut.isActive()).toBe(false);
    expect(tut.isComplete()).toBe(false);
  });

  it('should have at least 5 tutorial steps', () => {
    const tut = new Tutorial();
    expect(tut.getTotalSteps()).toBeGreaterThanOrEqual(5);
  });

  it('each step should have title and description', () => {
    const tut = new Tutorial();
    for (let i = 0; i < tut.getTotalSteps(); i++) {
      const step = tut.getCurrentStep();
      expect(step).toBeDefined();
      expect(step!.title.length).toBeGreaterThan(0);
      expect(step!.description.length).toBeGreaterThan(0);
      tut.next();
    }
  });

  it('should be restartable', () => {
    const tut = new Tutorial();
    tut.next();
    tut.next();
    tut.dismiss();
    expect(tut.isActive()).toBe(false);
    tut.restart();
    expect(tut.isActive()).toBe(true);
    expect(tut.getStepIndex()).toBe(0);
  });
});

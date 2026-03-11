import { describe, it, expect, beforeEach } from 'vitest';
import { PollutionManager, POLLUTION_DECAY_PER_CELL, POLLUTION_PARK_REDUCTION } from '../Pollution';
import { NaturalResourceManager, ResourceType } from '../NaturalResourceManager';
import { WaterFlow } from '../WaterFlow';

describe('PollutionManager', () => {
  let pm: PollutionManager;

  beforeEach(() => {
    pm = new PollutionManager(10, 10);
  });

  it('should create pollution at a source location', () => {
    pm.addSource(5, 5, 100, 'ground');
    pm.calculateSpread();
    const p = pm.getPollutionAt(5, 5);
    expect(p.ground).toBe(100);
  });

  it('should spread ground pollution to adjacent cells with decay', () => {
    pm.addSource(5, 5, 100, 'ground');
    pm.calculateSpread();
    const adjacent = pm.getPollutionAt(5, 6);
    expect(adjacent.ground).toBe(70); // 100 - 30 decay per cell
    const twoAway = pm.getPollutionAt(5, 7);
    expect(twoAway.ground).toBe(40); // 100 - 60 decay
  });

  it('should not spread pollution below zero', () => {
    pm.addSource(5, 5, 50, 'ground');
    pm.calculateSpread();
    const far = pm.getPollutionAt(5, 8);
    expect(far.ground).toBe(0);
  });

  it('should handle noise pollution', () => {
    pm.addSource(3, 3, 80, 'noise');
    pm.calculateSpread();
    expect(pm.getPollutionAt(3, 3).noise).toBe(80);
    expect(pm.getPollutionAt(3, 4).noise).toBe(50); // 80 - 30
  });

  it('should handle water pollution', () => {
    pm.addSource(2, 2, 60, 'water');
    pm.calculateSpread();
    expect(pm.getPollutionAt(2, 2).water).toBe(60);
  });

  it('should reduce pollution near parks', () => {
    pm.addSource(5, 5, 100, 'ground');
    pm.calculateSpread();
    pm.addParkEffect(5, 6, 2);
    // Park at (5,6) with radius 2 should reduce ground pollution by 20
    const atPark = pm.getPollutionAt(5, 6);
    expect(atPark.ground).toBe(50); // 70 - 20
  });

  it('should clamp pollution to zero minimum after park effect', () => {
    pm.addSource(5, 5, 30, 'ground');
    pm.calculateSpread();
    pm.addParkEffect(5, 6, 2);
    const reduced = pm.getPollutionAt(5, 6);
    expect(reduced.ground).toBe(0); // max(0, 0 - 20) capped at 0
  });

  it('should clear all sources', () => {
    pm.addSource(1, 1, 100, 'ground');
    pm.addSource(2, 2, 50, 'water');
    pm.clearSources();
    pm.calculateSpread();
    expect(pm.getPollutionAt(1, 1).ground).toBe(0);
    expect(pm.getPollutionAt(2, 2).water).toBe(0);
  });
});

describe('Pollution constants', () => {
  it('POLLUTION_DECAY_PER_CELL should be positive', () => {
    expect(POLLUTION_DECAY_PER_CELL).toBeGreaterThan(0);
  });

  it('POLLUTION_PARK_REDUCTION should be positive', () => {
    expect(POLLUTION_PARK_REDUCTION).toBeGreaterThan(0);
  });

  it('decay per cell should match spread behavior', () => {
    const pm = new PollutionManager(10, 10);
    pm.addSource(5, 5, 100, 'ground');
    pm.calculateSpread();
    // At distance 1, pollution = 100 - DECAY_PER_CELL
    expect(pm.getPollutionAt(5, 6).ground).toBe(100 - POLLUTION_DECAY_PER_CELL);
  });
});

describe('NaturalResourceManager', () => {
  let rm: NaturalResourceManager;

  beforeEach(() => {
    rm = new NaturalResourceManager();
    rm.initResources(10, 10);
  });

  it('should initialize resources on a grid', () => {
    // At least some cells should have resources
    let hasResource = false;
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const r = rm.getResourceAt(x, y);
        if (r.type !== ResourceType.NONE) {
          hasResource = true;
          expect(r.remaining).toBeGreaterThan(0);
        }
      }
    }
    expect(hasResource).toBe(true);
  });

  it('should allow setting a specific resource', () => {
    rm.setResource(3, 3, ResourceType.ORE, 500);
    const r = rm.getResourceAt(3, 3);
    expect(r.type).toBe(ResourceType.ORE);
    expect(r.remaining).toBe(500);
  });

  it('should extract resources and deplete them', () => {
    rm.setResource(2, 2, ResourceType.OIL, 100);
    const extracted = rm.extract(2, 2, 40);
    expect(extracted).toBe(40);
    const after = rm.getResourceAt(2, 2);
    expect(after.remaining).toBe(60);
  });

  it('should not extract more than remaining', () => {
    rm.setResource(1, 1, ResourceType.FERTILE, 30);
    const extracted = rm.extract(1, 1, 50);
    expect(extracted).toBe(30);
    expect(rm.getResourceAt(1, 1).remaining).toBe(0);
  });

  it('should report exhausted resources', () => {
    rm.setResource(4, 4, ResourceType.FOREST, 10);
    rm.extract(4, 4, 10);
    expect(rm.isExhausted(4, 4)).toBe(true);
  });

  it('should return NONE for cells without resources', () => {
    rm.setResource(7, 7, ResourceType.NONE, 0);
    const r = rm.getResourceAt(7, 7);
    expect(r.type).toBe(ResourceType.NONE);
    expect(r.remaining).toBe(0);
  });

  it('exhausted resource extraction returns 0', () => {
    rm.setResource(6, 6, ResourceType.ORE, 10);
    rm.extract(6, 6, 10);
    const extracted = rm.extract(6, 6, 5);
    expect(extracted).toBe(0);
  });
});

describe('WaterFlow', () => {
  let wf: WaterFlow;

  beforeEach(() => {
    wf = new WaterFlow(10, 10);
  });

  it('should set and get flow direction', () => {
    wf.setFlowDirection(3, 3, 'E');
    expect(wf.getFlowDirection(3, 3)).toBe('E');
  });

  it('should default to no flow direction', () => {
    expect(wf.getFlowDirection(0, 0)).toBe('');
  });

  it('should spread water pollution along flow direction', () => {
    wf.setFlowDirection(2, 2, 'E');
    wf.setFlowDirection(3, 2, 'E');
    wf.setFlowDirection(4, 2, 'E');
    wf.spreadWaterPollution(2, 2, 100);

    // Pollution should flow east with decay
    const atSource = wf.getPollutionAt(2, 2);
    expect(atSource).toBe(100);

    const oneStep = wf.getPollutionAt(3, 2);
    expect(oneStep).toBe(70); // 100 - 30

    const twoSteps = wf.getPollutionAt(4, 2);
    expect(twoSteps).toBe(40); // 70 - 30
  });

  it('should stop spreading when pollution decays to zero', () => {
    wf.setFlowDirection(0, 0, 'S');
    wf.setFlowDirection(0, 1, 'S');
    wf.setFlowDirection(0, 2, 'S');
    wf.setFlowDirection(0, 3, 'S');
    wf.setFlowDirection(0, 4, 'S');
    wf.spreadWaterPollution(0, 0, 50);

    expect(wf.getPollutionAt(0, 0)).toBe(50);
    expect(wf.getPollutionAt(0, 1)).toBe(20); // 50 - 30
    expect(wf.getPollutionAt(0, 2)).toBe(0); // max(0, 20 - 30)
  });

  it('should not spread against flow direction', () => {
    wf.setFlowDirection(5, 5, 'E');
    wf.spreadWaterPollution(5, 5, 100);
    // West of source should have no pollution
    expect(wf.getPollutionAt(4, 5)).toBe(0);
  });
});

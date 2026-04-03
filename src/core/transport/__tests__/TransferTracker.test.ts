import { describe, it, expect } from 'vitest';
import { TransferTracker } from '../TransferTracker';

describe('TransferTracker', () => {
  it('starts with empty state', () => {
    const tracker = new TransferTracker();
    const h = tracker.getHistory();
    expect(h.history.length).toBe(7);
    expect(h.today.size).toBe(0);
    expect(h.pedsSnapshot).toBe(0);
  });

  it('records transfer usage', () => {
    const tracker = new TransferTracker();
    tracker.recordTransfer('🚌→🚇');
    tracker.recordTransfer('🚌→🚇');
    tracker.recordTransfer('🚇→🚂');
    const h = tracker.getHistory();
    expect(h.today.get('🚌→🚇')).toBe(2);
    expect(h.today.get('🚇→🚂')).toBe(1);
  });

  it('records building usage', () => {
    const tracker = new TransferTracker();
    tracker.recordBuilding('🚌→🚇', '1,1', '5,5');
    tracker.recordBuilding('🚌→🚇', '2,2', '6,6');
    const bldgs = tracker.getBuildings('🚌→🚇');
    expect(bldgs.homes).toContain('1,1');
    expect(bldgs.homes).toContain('2,2');
    expect(bldgs.works).toContain('5,5');
  });

  it('returns empty buildings for unknown label', () => {
    const tracker = new TransferTracker();
    const bldgs = tracker.getBuildings('unknown');
    expect(bldgs.homes).toEqual([]);
    expect(bldgs.works).toEqual([]);
  });

  it('rolls over daily counts into ring buffer', () => {
    const tracker = new TransferTracker();
    tracker.recordTransfer('🚌→🚇');
    tracker.rolloverDay(10);
    // today should be cleared after rollover
    const h = tracker.getHistory();
    expect(h.today.size).toBe(0);
    // history ring buffer should contain the rolled-over data
    const totalInHistory = h.history.reduce((sum, m) => {
      for (const v of m.values()) sum += v;
      return sum;
    }, 0);
    expect(totalInHistory).toBe(1);
  });

  it('updates ped snapshot on rollover', () => {
    const tracker = new TransferTracker();
    tracker.rolloverDay(42);
    expect(tracker.getHistory().pedsSnapshot).toBe(42);
  });

  it('computes weekly totals correctly', () => {
    const tracker = new TransferTracker();
    // Simulate 3 days of transfers
    tracker.recordTransfer('🚌→🚇');
    tracker.recordTransfer('🚌→🚇');
    tracker.rolloverDay(0);
    tracker.recordTransfer('🚌→🚇');
    tracker.rolloverDay(0);
    tracker.recordTransfer('🚌→🚇');
    // Weekly total: 2 (day 1) + 1 (day 2) + 1 (today) = 4
    expect(tracker.getWeeklyTotal('🚌→🚇')).toBe(4);
  });

  it('clears buildings on clearBuildings()', () => {
    const tracker = new TransferTracker();
    tracker.recordBuilding('🚌→🚇', '1,1', '5,5');
    tracker.clearBuildings();
    const bldgs = tracker.getBuildings('🚌→🚇');
    expect(bldgs.homes).toEqual([]);
  });

  it('save/restore round-trips correctly', () => {
    const tracker = new TransferTracker();
    tracker.recordTransfer('🚌→🚇');
    tracker.rolloverDay(7);
    tracker.recordTransfer('🚇→🚂');

    const saved = tracker.getHistory();
    const restored = new TransferTracker();
    restored.setHistory(saved);

    const h = restored.getHistory();
    expect(h.today.get('🚇→🚂')).toBe(1);
    expect(h.pedsSnapshot).toBe(7);
  });
});

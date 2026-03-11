import { describe, it, expect } from 'vitest';
import { MetroSystem } from '../MetroSystem';
import { collectMetroTrainData } from '../collectMetroTrains';

describe('collectMetroTrainData', () => {
  it('should return empty array when no trains', () => {
    const metro = new MetroSystem();
    expect(collectMetroTrainData(metro)).toEqual([]);
  });

  it('should return train data with atStop info', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    const line = metro.createLine([st1, st2]);
    metro.tick(); // initial → atStop

    const data = collectMetroTrainData(metro);
    expect(data).toHaveLength(1);
    expect(data[0]!.lineId).toBe(line.id);
    expect(data[0]!.atStop).toBe(true);
    expect(data[0]!.fromStopIndex).toBe(0);
  });

  it('should return travel progress for moving trains', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    metro.createLine([st1, st2]);
    metro.tick(); // initial → atStop
    metro.tick(); // dwell
    metro.tick(); // depart
    metro.tick(); // traveling, progress > 0

    const data = collectMetroTrainData(metro);
    expect(data[0]!.atStop).toBe(false);
    expect(data[0]!.progress).toBeGreaterThan(0);
  });

  it('should handle multiple trains on multiple lines', () => {
    const metro = new MetroSystem();
    const st1 = metro.addStation(0, 0);
    const st2 = metro.addStation(6, 0);
    const st3 = metro.addStation(0, 6);
    const st4 = metro.addStation(6, 6);
    metro.createLine([st1, st2], 2);
    metro.createLine([st3, st4], 1);
    metro.tick();

    const data = collectMetroTrainData(metro);
    expect(data).toHaveLength(3); // 2 on line 1 + 1 on line 2
  });
});

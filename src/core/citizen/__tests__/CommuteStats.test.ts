import { describe, it, expect } from 'vitest';
import { computeCommuteStats, COMMUTE_BUCKET_EDGES } from '../CommuteStats';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';

/**
 * City-wide commute time statistics, shared by the overlay and the overview panel.
 *
 * Computed separately, the map turns red while the panel calls the average commute good, and the
 * player does not know which to believe.
 */

function citizen(id: number, homeId: string | null, workplaceId: string | null): Citizen {
  return {
    id, birthTick: 0, age: 100, lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE, happiness: 50, health: 80,
    homeId, workplaceId, unemployedSince: null, homelessSince: null,
    emigrationTolerance: 25, educationProgress: 0,
  };
}

/** Supplies a commute time and mode by id. */
function lookup(table: Record<number, { time: number; mode: string } | null>) {
  return (c: Citizen) => table[c.id] ?? null;
}

const THRESHOLD = 60;

describe('全城通勤統計', () => {
  it('should survive a city with nobody in it', () => {
    const s = computeCommuteStats([], () => null, THRESHOLD, 3);
    expect(s.sampled).toBe(0);
    expect(s.average).toBe(0);
    expect(s.median).toBe(0);
    expect(s.byHome.size).toBe(0);
    expect(s.worst).toEqual([]);
  });

  it('should average the residents of each home', () => {
    const cs = [citizen(1, '5,5', '9,9'), citizen(2, '5,5', '9,9'), citizen(3, '7,7', '9,9')];
    const s = computeCommuteStats(cs, lookup({
      1: { time: 10, mode: 'DRIVE' },
      2: { time: 30, mode: 'DRIVE' },
      3: { time: 50, mode: 'DRIVE' },
    }), THRESHOLD, 3);

    expect(s.byHome.get('5,5'), '同一格的住戶沒有取平均').toBe(20);
    expect(s.byHome.get('7,7')).toBe(50);
  });

  it('should report the average and median across everyone', () => {
    const cs = [1, 2, 3, 4, 5].map(i => citizen(i, `${i},0`, '9,9'));
    const s = computeCommuteStats(cs, lookup({
      1: { time: 10, mode: 'DRIVE' }, 2: { time: 20, mode: 'DRIVE' },
      3: { time: 30, mode: 'DRIVE' }, 4: { time: 40, mode: 'DRIVE' },
      5: { time: 100, mode: 'DRIVE' },
    }), THRESHOLD, 3);

    expect(s.average).toBe(40);
    expect(s.median, '中位數被離群值拉走了').toBe(30);
  });

  it('should give the same median as a full sort, at every size', () => {
    // The median no longer comes from a sort but from quickselect. This checks the answer is
    // unchanged: an off-by-one in the position, or a broken partition, turns it red.
    let seed = 987654321;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

    for (const n of [1, 2, 3, 4, 5, 9, 64, 257, 1000]) {
      const cs = Array.from({ length: n }, (_, i) => citizen(i, `${i},0`, '9,9'));
      const table: Record<number, { time: number; mode: string }> = {};
      for (let i = 0; i < n; i++) table[i] = { time: Math.round(rnd() * 200) / 4, mode: 'DRIVE' };

      const s = computeCommuteStats(cs, lookup(table), THRESHOLD, 3);
      const sorted = Object.values(table).map(v => v.time).sort((a, b) => a - b);

      expect(s.median, `n=${n}`).toBe(sorted[Math.floor(n / 2)]);
    }
  });

  it('should count who is over the threshold', () => {
    const cs = [1, 2, 3].map(i => citizen(i, `${i},0`, '9,9'));
    const s = computeCommuteStats(cs, lookup({
      1: { time: 59, mode: 'DRIVE' },
      2: { time: 60, mode: 'DRIVE' },
      3: { time: 61, mode: 'DRIVE' },
    }), THRESHOLD, 3);
    expect(s.overThreshold, '門檻上剛好那一位不該算進去').toBe(1);
  });

  it('should bucket the distribution', () => {
    const times = [5, 12, 20, 28, 35, 50, 70, 90];
    const cs = times.map((_, i) => citizen(i + 1, `${i},0`, '9,9'));
    const table: Record<number, { time: number; mode: string }> = {};
    times.forEach((t, i) => { table[i + 1] = { time: t, mode: 'DRIVE' }; });

    const s = computeCommuteStats(cs, lookup(table), THRESHOLD, 3);
    expect(s.buckets, '分桶數量與邊界數對不上').toHaveLength(COMMUTE_BUCKET_EDGES.length + 1);
    expect(s.buckets.reduce((a, b) => a + b, 0)).toBe(times.length);
    expect(s.buckets[0], '0~15 應該有 5 與 12 兩人').toBe(2);
    expect(s.buckets[s.buckets.length - 1], '60 以上應該有 70 與 90 兩人').toBe(2);
  });

  it('should break the population down by how they travel', () => {
    const cs = [1, 2, 3].map(i => citizen(i, `${i},0`, '9,9'));
    const s = computeCommuteStats(cs, lookup({
      1: { time: 10, mode: 'METRO' },
      2: { time: 20, mode: 'METRO' },
      3: { time: 30, mode: 'DRIVE' },
    }), THRESHOLD, 3);

    expect(s.byMode['METRO']).toBe(2);
    expect(s.byMode['DRIVE']).toBe(1);
  });

  it('should list the worst homes, worst first', () => {
    const cs = [
      citizen(1, '1,1', '9,9'), citizen(2, '2,2', '9,9'),
      citizen(3, '3,3', '9,9'), citizen(4, '3,3', '9,9'),
    ];
    const s = computeCommuteStats(cs, lookup({
      1: { time: 20, mode: 'DRIVE' }, 2: { time: 80, mode: 'DRIVE' },
      3: { time: 50, mode: 'DRIVE' }, 4: { time: 50, mode: 'DRIVE' },
    }), THRESHOLD, 2);

    expect(s.worst.map(w => w.pos), '最糟的住宅區沒有排在前面').toEqual(['2,2', '3,3']);
    expect(s.worst[0]!.time).toBe(80);
    expect(s.worst[1]!.residents, '沒有回報那一格住了幾個人').toBe(2);
  });

  it('should ignore citizens with no home or no job', () => {
    const cs = [citizen(1, null, '9,9'), citizen(2, '5,5', null), citizen(3, '5,5', '9,9')];
    const s = computeCommuteStats(cs, lookup({ 3: { time: 40, mode: 'DRIVE' } }), THRESHOLD, 3);
    expect(s.sampled).toBe(1);
    expect(s.byHome.size).toBe(1);
  });

  it('should ignore a commute that cannot be estimated', () => {
    // Just after a road change and before the recompute, some commutes cannot be computed.
    // Counting them as 0 drops the average sharply.
    const cs = [citizen(1, '5,5', '9,9'), citizen(2, '6,6', '9,9')];
    const s = computeCommuteStats(cs, lookup({ 1: { time: 40, mode: 'DRIVE' }, 2: null }), THRESHOLD, 3);
    expect(s.sampled).toBe(1);
    expect(s.average).toBe(40);
    expect(s.byHome.has('6,6'), '算不出通勤的格子被畫上了顏色').toBe(false);
  });
});

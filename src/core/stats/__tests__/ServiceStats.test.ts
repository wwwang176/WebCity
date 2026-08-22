import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildServicesStats } from '../ServiceStats';

describe('服務統計', () => {
  it('should list every service the coverage panel scores', () => {
    // 面板左上角的平均覆蓋率就是這九項的平均。少一項，平均就跟畫面對不起來。
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.services.map(x => x.service)).toEqual([
      'power', 'water', 'sewage', 'police', 'fire',
      'health', 'education', 'garbage', 'deathCare',
    ]);
  });

  it('should not count a dead station towards the capacity the city can use', () => {
    // 停電的警局不巡邏。把它的容量加進總量，面板會說「還有餘裕」而街上正在失控
    // （BUG-138、BUG-100）。
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities, '設施沒被列出來').toHaveLength(1);
    expect(police.facilities[0]!.operational).toBe(false);
    expect(police.capacity, '壞掉的局還在貢獻容量').toBe(0);
  });

  it('should still list the dead station so the player can see it is dead', () => {
    // 從清單裡拿掉的話，玩家只會看到覆蓋率掉了卻找不到原因 ——
    // 所以帳面容量要留在那一筆上，只是不計入全市可用容量。
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities[0]!.capacity, '帳面容量要留著').toBeGreaterThan(0);
  });

  it('should count a working station', () => {
    // 反過來也要成立 —— 不然「容量永遠是 0」也會讓上面兩條通過。
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.facilities[0]!.operational).toBe(true);
    expect(police.capacity).toBe(police.facilities[0]!.capacity);
  });

  it('should call it a shortage even when there is no capacity at all', () => {
    // 舊的 `capacity > 0 && load > capacity` 在全城停電時把警示關掉了 ——
    // 正是最該亮的時候。這裡把負載分配好之後才讓警局斷電:負載留著，容量歸零。
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);
    state.police.updateStationLoads([{ x: 3, y: 3, weight: 500 }]);
    state.police.updateOperationalStatus(() => false);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.load, '負載被清掉了，這條就測不到東西').toBeGreaterThan(0);
    expect(police.capacity).toBe(0);
    expect(police.shortage, '全城停電時警示被關掉了').toBe(true);
  });

  it('should not cry shortage when capacity covers the load', () => {
    const state = createGameState(8, 8);
    state.police.addStation(3, 3);
    state.police.updateOperationalStatus(() => true);

    const police = buildServicesStats(state).services.find(x => x.service === 'police')!;

    expect(police.shortage).toBe(false);
  });

  it('should average coverage across every service, not just the ones with facilities', () => {
    // 一座只蓋了警局的城市，平均覆蓋率不該因為「其他八項沒有設施」而被跳過。
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.avgCoverage).toBeCloseTo(
      s.services.reduce((a, b) => a + b.coverage, 0) / s.services.length, 6,
    );
  });

  it('should count how many services are under half covered', () => {
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.gaps).toBe(s.services.filter(x => x.coverage < 0.5).length);
  });

  it('should say how many students want a school, not just how many got in', () => {
    // 在學人數頂多等於容量。想讀的人可以更多 —— 差額就是該再蓋幾間的依據。
    const state = createGameState(8, 8);
    state.education.addSchool(3, 3, 'elementary' as never);

    const edu = buildServicesStats(state).services.find(x => x.service === 'education')!;

    expect(edu.facilities[0]!.demand, '沒給需求人數').toBeTypeOf('number');
    expect(edu.facilities[0]!.subtype, '沒說是哪一種學校').toBe('elementary');
  });

  it('should carry the flows that the standing totals cannot show', () => {
    // 「掩埋場七成滿」看不出還撐幾週。每週進來多少才看得出。
    const s = buildServicesStats(createGameState(8, 8));

    expect(s.garbageProducedPerWeek).toBe(0);
    expect(s.deathsPerWeek).toBe(0);
    expect(s.activeFires).toBe(0);
  });
});

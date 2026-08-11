import { describe, it, expect } from 'vitest';
import {
  busStopPlan, metroStationPlan, trainStationPlan, ferryDockPlan,
} from '../transit';
import { FACADE_TRANSIT, PART_GROUND, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { CIVIC_INSET } from '../../types';
import { propExtent } from '../../../props';
import { TRACK_WIDTH } from '../../../../TrackRenderer';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicPlan } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);

const PLANS = [
  ['公車站', busStopPlan, 'bus_stop'],
  ['捷運站', metroStationPlan, 'metro_station'],
  ['火車站', trainStationPlan, 'train_station'],
  ['渡輪碼頭', ferryDockPlan, 'ferry_dock'],
] as const;

/**
 * 四座交通站點。共通的驗收在 `CivicPlans.test.ts` 的資料表裡。
 *
 * 它們全部是 1×1 —— 全專案最緊的尺度（可用範圍只有 ±5.76 m）。所以這裡多了
 * 一組別的批次不需要的驗收：**東西真的塞得下嗎**。
 */
describe.each(PLANS)('%s', (_label, plan, type) => {
  it('should use the transit facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_TRANSIT);
    expect(plan.color).toEqual(civicColorOf(type));
    expect(plan.footprint).toEqual({ w: 1, h: 1 });
  });

  /**
   * 1×1 上 `CIVIC_INSET` 吃掉的比例是別人的好幾倍。
   *
   * 2×2 的基地扣掉 0.02 格只少了 2%，1×1 少了 4% —— 而 12 m 的地上那 0.48 m
   * 是真的會讓一座候車亭放不下。這條測試量的是「還剩多少」：緊到只剩幾公分
   * 的話，之後任何一次微調都會撞牆，而錯誤訊息只會說「超出佔地」。
   */
  it('should leave some slack inside the tightest footprint in the game', () => {
    const limit = 0.5 - CIVIC_INSET;
    let used = 0;
    for (const v of [...plan.massing, ...plan.props, ...plan.overhead]) {
      used = Math.max(used,
        Math.abs(v.x) + v.w / 2, Math.abs(v.z) + v.d / 2);
    }
    for (const f of plan.fixtures) {
      const e = propExtent(f);
      used = Math.max(used, Math.abs(f.x) + e.x, Math.abs(f.z) + e.z);
    }
    expect(used, `${type} 已經頂到佔地邊界`).toBeLessThanOrEqual(limit);
    expect(m(limit - used), `${type} 只剩 ${m(limit - used).toFixed(2)} m 餘裕`)
      .toBeGreaterThan(0.05);
  });

  /**
   * 發光的識別柱。
   *
   * 這是四座共用的夜間語彙 —— 12 m 的基地上唯一放得下的「亮」。少了它，
   * 一座車站在夜景裡與一塊空地沒有分別。
   */
  it('should carry a lit totem', () => {
    const panel = tagged(plan, 'totem');
    const post = plan.props.filter(v => v.tag === 'totemPost');
    expect(panel.length, '沒有識別柱').toBe(1);
    expect(post.length, '識別柱沒有柱身').toBe(1);
    expect(panel[0]!.part, '識別柱不會亮').toBe(PART_LAMP);
    expect(post[0]!.part, '柱身也在發光 —— 那是一根從地上亮到頂的柱子')
      .not.toBe(PART_LAMP);
    expect(post[0]!.y1, '燈箱沒有接在柱身上').toBeCloseTo(panel[0]!.y0, 9);
    expect(post[0]!.x, '燈箱與柱身不在同一個位置').toBeCloseTo(panel[0]!.x, 9);
  });

  it('should keep the totem panel in the massing layer', () => {
    // 放在 `props` 的話遠景整層關掉，而那正是最需要看到它的距離。
    expect(plan.massing.some(v => v.tag === 'totem'), '識別柱會被遠景關掉')
      .toBe(true);
  });

  it('should give every raised paving an actual shade', () => {
    // 月台、棧橋、階梯口都走 `PART_GROUND`。沒有 `shade` 的話 B 通道是 0，
    // 那是柏油黑而不是想要的顏色，而這個錯完全不會報。
    for (const v of plan.massing.filter(v => v.part === PART_GROUND)) {
      expect(v.shade, `${v.tag} 是 PART_GROUND 卻沒有明度`).toBeDefined();
    }
  });

  it('should stay low enough not to overshadow a 12 m plot', () => {
    // 12 m 的地上蓋 15 m 的東西，等角視角下它會遮住後面兩排房子。
    const top = m(topOf(plan.massing));
    expect(top, `${type} 蓋到 ${top.toFixed(1)} m`).toBeLessThan(12);
  });
});

describe('公車站', () => {
  it('should shelter the bench under a roof on posts', () => {
    // 四面牆的候車亭看不到公車來了。背板一面 + 兩根前柱 + 一片頂。
    const posts = busStopPlan.props.filter(v => v.tag === 'post');
    const roof = busStopPlan.overhead.find(v => v.tag === 'shelterRoof')!;
    const back = tagged(busStopPlan, 'backPanel')[0]!;
    expect(posts.length, '候車亭沒有前柱').toBe(2);
    expect(roof, '候車亭沒有頂').toBeTruthy();
    expect(back, '候車亭沒有背板').toBeTruthy();
    for (const p of posts) expect(p.y1, '柱子沒有頂到頂棚').toBeCloseTo(roof.y0, 9);
    expect(back.y1, '背板沒有接到頂棚').toBeCloseTo(roof.y0, 9);
    // 長椅要在頂棚底下。
    const bench = busStopPlan.props.find(v => v.tag === 'bench')!;
    expect(Math.abs(bench.z - roof.z), '長椅淋得到雨')
      .toBeLessThanOrEqual(roof.d / 2);
  });

  /**
   * 站牌前**不擺**靜態公車。
   *
   * 使用者：「公車站本來就會有公車在路上跑，所以公車站內不需要放公車」。
   * 城市裡的公車是 `VehicleRenderer` 開著的真車，會照路線停靠 —— 站牌前再擺
   * 一台不會動的，就變成一台永遠停在那裡擋住真車的公車。
   *
   * 這與消防局停消防車、機場停飛機不一樣：那兩種車**平常就停在基地上**，
   * 而公車平常在路上。
   */
  it('should leave the bay for the buses that actually drive', () => {
    expect(busStopPlan.vehicles, '站牌前擺了一台不會動的公車').toEqual([]);
  });

  it('should still mark the bay so it reads as a stop', () => {
    // 車不擺了，但停靠彎與黃線要留著 —— 那才是「這裡是站牌」的訊號。
    const bay = busStopPlan.decals.find(d =>
      (d.layer ?? 'base') === 'base' && d.shade < 0.2);
    expect(bay, '沒有停靠彎').toBeTruthy();
    expect(busStopPlan.decals.some(d => d.layer === 'mark' && d.shade > 0.7),
      '停靠彎沒有標線').toBe(true);
  });
});

describe('捷運站', () => {
  it('should show that there is a hole in the ground', () => {
    // 深色的階梯口是「這裡有洞」的唯一訊號 —— 少了它，出入口就只是一個
    // 小盒子，與變電箱分不出來。
    const mouth = tagged(metroStationPlan, 'stairMouth')[0]!;
    expect(mouth, '沒有階梯口').toBeTruthy();
    expect(mouth.part).toBe(PART_GROUND);
    expect(mouth.shade!, '階梯口不夠暗，看起來像鋪面').toBeLessThan(0.15);
  });

  /**
   * 四面都下得去。
   *
   * 使用者：「地鐵站的形象也要改一下，要看起來像可以從四面下樓的通道建築」。
   * 這一條問的是「四個方向**各有一個**入口」，而不是「有四個入口」——
   * 四個全擠在同一邊也是四個。
   */
  it('should let people down from all four sides', () => {
    const mouths = tagged(metroStationPlan, 'stairMouth');
    expect(mouths.length, '階梯口不是四個').toBe(4);
    const dir = (v: { x: number; z: number }) =>
      Math.abs(v.x) > Math.abs(v.z) ? (v.x > 0 ? 'E' : 'W') : (v.z > 0 ? 'S' : 'N');
    expect(new Set(mouths.map(dir)).size, '四個階梯口沒有各朝一個方向').toBe(4);
    for (const v of mouths) {
      expect(v.part, '階梯口不是洞').toBe(PART_GROUND);
      expect(v.shade!, '階梯口不夠暗，看起來像鋪面').toBeLessThan(0.15);
    }
  });

  it('should run every stair mouth out to the pavement', () => {
    // 四個口圍在通道旁邊的話，「四面下樓」是假的：人走到通道邊會發現
    // 那裡只是一塊深色的地。每一個都要從通道的牆一路接到人行道。
    const concourse = tagged(metroStationPlan, 'concourse')[0]!;
    const edge = 0.5 - CIVIC_INSET;
    for (const v of tagged(metroStationPlan, 'stairMouth')) {
      const along = Math.abs(v.x) > Math.abs(v.z)
        ? { c: Math.abs(v.x), half: v.w / 2, wall: concourse.w / 2 }
        : { c: Math.abs(v.z), half: v.d / 2, wall: concourse.d / 2 };
      expect(along.c - along.half, '階梯口沒有接到通道的牆')
        .toBeCloseTo(along.wall, 6);
      expect(m(edge - (along.c + along.half)), '階梯口沒有通到人行道')
        .toBeLessThan(1.5);
    }
  });

  it('should rail off every stair mouth', () => {
    // 一個沒有欄杆的洞是地上的一塊污漬。
    const rails = metroStationPlan.props.filter(v => v.tag === 'rail');
    expect(rails.length, '欄杆不是每個口兩道').toBe(8);
    for (const v of tagged(metroStationPlan, 'stairMouth')) {
      const beside = rails.filter(r =>
        Math.abs(r.x - v.x) <= v.w / 2 + 1e-9 && Math.abs(r.z - v.z) <= v.d / 2 + 1e-9);
      expect(beside.length, `(${v.x}, ${v.z}) 的階梯口沒有兩道欄杆`).toBe(2);
    }
  });
});

describe('火車站', () => {
  it('should be the tallest of the four', () => {
    // 四座裡唯一有「站體」的一座。
    const top = topOf(trainStationPlan.massing);
    for (const [, other] of PLANS.filter(([, p]) => p !== trainStationPlan)) {
      expect(top, '火車站不是最高的').toBeGreaterThan(topOf(other.massing));
    }
  });

  /**
   * 火車站不畫自己的鐵軌，而且要讓開真的那一條。
   *
   * 使用者：「我記得好像會蓋在鐵軌邊緣? 所以不用畫出鐵軌吧? 你查證看看」。
   * 查了：比「邊緣」更強 —— `canPlaceTransportStop` 規定火車站蓋在
   * `railType ≠ 0` 的格子**上**，`placeTransportStopOnGrid` 只改
   * buildingId／reserved／zoneType，所以軌道還在那一格裡，`TrackRenderer`
   * 照樣畫碴床、枕木與鋼軌，貼著**格心**。
   *
   * 於是這一條守兩件事：不准自己畫一條（會與真的那條各在各的位置），
   * 也不准蓋在它上面（列車會從大廳裡開過去）。走廊寬度直接取
   * `TrackRenderer` 的 `TRACK_WIDTH` —— 抄一個數字的話，那邊調寬了這邊
   * 不會知道。
   */
  it('should leave the real track a clear corridor', () => {
    expect(trainStationPlan.props.filter(v => v.tag === 'rail').length,
      '火車站自己畫了鋼軌 —— TrackRenderer 已經在同一格畫過了').toBe(0);

    const half = TRACK_WIDTH;   // 碴床半寬的兩倍：車體比軌距寬
    const all = [
      ...trainStationPlan.massing, ...trainStationPlan.props,
      ...trainStationPlan.overhead,
    ];
    for (const v of all) {
      const clear = v.z - v.d / 2 >= half - 1e-9 || v.z + v.d / 2 <= -half + 1e-9;
      expect(clear, `${v.tag} 蓋在軌道走廊上 —— 真的鋼軌會從它裡面穿出來`)
        .toBe(true);
    }
    for (const f of trainStationPlan.fixtures) {
      const e = propExtent(f);
      const clear = f.z - e.z >= half - 1e-9 || f.z + e.z <= -half + 1e-9;
      expect(clear, `${f.kind} 站在軌道走廊上`).toBe(true);
    }
  });

  it('should put the hall and the platform on opposite sides of the track', () => {
    // 同一側的話中間那條走廊是站區的邊界，而不是「軌道從站中間穿過去」。
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(Math.sign(hall.z), '站房與月台在軌道的同一側')
      .not.toBe(Math.sign(platform.z));
  });

  it('should raise the platform beside the track', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(platform.part).toBe(PART_GROUND);
    const h = m(platform.y1 - platform.y0);
    expect(h, `月台只有 ${h.toFixed(2)} m 高 —— 那是一塊鋪面`).toBeGreaterThan(0.5);
    // 而且要沿著軌道走滿整格 —— 只有一小段的話那是一塊台階。
    expect(m(platform.w), '月台太短，停不下一節車廂').toBeGreaterThan(10);
  });

  it('should hang a lit clock on the front', () => {
    const clock = tagged(trainStationPlan, 'clock')[0]!;
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    expect(clock.part, '大鐘不會亮').toBe(PART_LAMP);
    expect(clock.z - clock.d / 2, '大鐘埋在牆裡')
      .toBeGreaterThanOrEqual(hall.z + hall.d / 2 - 1e-9);
  });

  it('should carry the platform canopy on posts standing on the platform', () => {
    const posts = trainStationPlan.props.filter(v => v.tag === 'canopyPost');
    const canopy = trainStationPlan.overhead.find(v => v.tag === 'platformCanopy')!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(posts.length, '月台雨棚沒有柱子').toBeGreaterThanOrEqual(4);
    for (const p of posts) {
      expect(p.y0, '柱子沒有站在月台上').toBeCloseTo(platform.y1, 9);
      expect(p.y1, '柱子沒有頂到雨棚').toBeCloseTo(canopy.y0, 9);
    }
  });
});

describe('渡輪碼頭', () => {
  it('should make half the plot water', () => {
    // 少了水，候船室就只是一間小房子。深色水面與棧橋的明度差是它的全部。
    const base = ferryDockPlan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const water = base.find(d => d.shade < 0.1)!;
    expect(water, '碼頭沒有水').toBeTruthy();
    const total = base.reduce((s, d) => s + d.w * d.d, 0);
    expect((water.w * water.d) / total, '水面太小').toBeGreaterThan(0.4);
  });

  it('should build the jetty out over the water', () => {
    const jetty = tagged(ferryDockPlan, 'jetty')[0]!;
    const water = ferryDockPlan.decals.find(d =>
      (d.layer ?? 'base') === 'base' && d.shade < 0.1)!;
    expect(jetty.part, '棧橋會長出窗戶').toBe(PART_GROUND);
    expect(jetty.shade!, '棧橋與水一樣暗 —— 看不出有橋')
      .toBeGreaterThan(water.shade + 0.2);
    // 棧橋要伸進水裡，不是停在岸上。
    expect(jetty.z + jetty.d / 2, '棧橋沒有伸進水裡')
      .toBeGreaterThan(water.z);
  });

  it('should light the end of the jetty', () => {
    // 棧橋盡頭那一點光是碼頭夜裡唯一的東西。
    const light = tagged(ferryDockPlan, 'navLight')[0]!;
    const jetty = tagged(ferryDockPlan, 'jetty')[0]!;
    expect(light.part).toBe(PART_LAMP);
    expect(light.z, '標誌燈不在棧橋盡頭').toBeGreaterThan(jetty.z);
  });

  it('should give the ferry something to tie up to', () => {
    const moorings = ferryDockPlan.props.filter(v => v.tag === 'mooring');
    const jetty = tagged(ferryDockPlan, 'jetty')[0]!;
    expect(moorings.length, '沒有繫纜樁').toBeGreaterThanOrEqual(2);
    for (const v of moorings) {
      expect(v.y0, '繫纜樁沉在棧橋裡').toBeCloseTo(jetty.y1, 9);
    }
  });
});

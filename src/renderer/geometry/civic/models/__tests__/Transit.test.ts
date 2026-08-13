import { describe, it, expect } from 'vitest';
import {
  busStopPlan, metroStationPlan, trainStationPlan, ferryDockPlan,
} from '../transit';
import { FACADE_TRANSIT, PART_GROUND, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { CIVIC_INSET } from '../../types';
import { propExtent } from '../../../props';
import { TRACK_WIDTH, TRACK_CLEARANCE } from '../../../../TrackRenderer';
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
   * 它要讀成一座四面都能下樓的通道建築。
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
  it('should be the tallest of the four, but still a low building', () => {
    // 四座裡唯一有「站體」的一座，所以它要最高 —— 但也要壓在 8 m 以內：
    // 一塊 12 m 的地上，超過那個高度的房子
    // 在等角視角下的立面比它的屋頂還大，讀起來是一座塔。
    const top = topOf(trainStationPlan.massing);
    for (const [, other] of PLANS.filter(([, p]) => p !== trainStationPlan)) {
      expect(top, '火車站不是最高的').toBeGreaterThan(topOf(other.massing));
    }
    expect(m(top), `站房蓋到 ${m(top).toFixed(1)} m`).toBeLessThan(8);
  });

  /**
   * 火車站不畫自己的鐵軌，而且要讓開真的那一條。
   *
   * 查過了，比「蓋在鐵軌邊緣」更強 —— `canPlaceTransportStop` 規定火車站
   * 蓋在 `railType ≠ 0` 的格子**上**，`placeTransportStopOnGrid` 只改
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
      const aside = v.z - v.d / 2 >= half - 1e-9 || v.z + v.d / 2 <= -half + 1e-9;
      // 跨過去也可以，只要**跨得夠高**。走廊是淨空包絡線不是禁建區 ——
      // 天橋與跨站站房本來就在軌道上方，而把它寫成禁建區的話，火車站就
      // 只能是「兩側各擺一棟、彼此不相連」。
      const above = v.y0 >= TRACK_CLEARANCE - 1e-9;
      expect(aside || above,
        `${v.tag} 蓋在軌道走廊上，而且沒有跨過去的淨空`).toBe(true);
    }
    // 地面上的東西沒有「跨過去」這個選項。
    for (const f of trainStationPlan.fixtures) {
      const e = propExtent(f);
      const clear = f.z - e.z >= half - 1e-9 || f.z + e.z <= -half + 1e-9;
      expect(clear, `${f.kind} 站在軌道走廊上`).toBe(true);
    }
  });

  /**
   * 站房**站在月台上**。
   *
   * 前兩版都在拆這一棟：先是站房在軌道的一側、月台在另一側，中間讓出走廊
   * —— 兩棟各自站著，讀起來是「一棟房子旁邊有一塊月台」。再來是加一道跨站
   * 天橋把兩邊接起來，而那把一塊 12 m 的地塞進了天橋、樓梯塔與兩道欄杆，
   * 月台被切成兩截。
   *
   * 真實的小車站根本不跨線：站房就蓋在月台上，月台是它旁邊那一片鋪面加
   * 一道雨遮。所以兩者現在同在軌道的一側，站房的底面**就是**月台的頂面 ——
   * 「連在一起」不需要任何構造物，它們本來就是同一塊台子。
   */
  it('should stand the hall on the platform, not across the track', () => {
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;

    expect(tagged(trainStationPlan, 'footbridge').length, '天橋還在').toBe(0);
    expect(tagged(trainStationPlan, 'stairTower').length, '樓梯塔還在').toBe(0);

    // 同一側 —— 隔著軌道的話它們永遠連不起來。
    expect(Math.sign(hall.z), '站房與月台隔著軌道')
      .toBe(Math.sign(platform.z));
    // 站房的底面坐在月台面上。
    expect(hall.y0, '站房沒有坐在月台上').toBeCloseTo(platform.y1, 9);
    // 而且要整棟落在月台的範圍裡，不然它有一角是懸空的。
    expect(hall.x - hall.w / 2, '站房的一角伸出月台外')
      .toBeGreaterThanOrEqual(platform.x - platform.w / 2 - 1e-9);
    expect(hall.x + hall.w / 2).toBeLessThanOrEqual(platform.x + platform.w / 2 + 1e-9);
    expect(hall.z - hall.d / 2)
      .toBeGreaterThanOrEqual(platform.z - platform.d / 2 - 1e-9);
    expect(hall.z + hall.d / 2).toBeLessThanOrEqual(platform.z + platform.d / 2 + 1e-9);
  });

  it('should leave the platform room to stand on beside the hall', () => {
    // 站房佔掉整片月台的話，那不是月台，是一棟蓋在台子上的房子。
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    const free = m(platform.w) - m(hall.w);
    expect(free, `月台只剩 ${free.toFixed(1)} m 站人`).toBeGreaterThan(5);
  });

  it('should raise the platform beside the track', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(platform.part).toBe(PART_GROUND);
    const h = m(platform.y1 - platform.y0);
    expect(h, `月台只有 ${h.toFixed(2)} m 高 —— 那是一塊鋪面`).toBeGreaterThan(0.5);
    // 而且要沿著軌道走滿整格 —— 只有一小段的話那是一塊台階。
    expect(m(platform.w), '月台太短，停不下一節車廂').toBeGreaterThan(10);
  });

  /**
   * 月台要與旁邊的鋪面**分得開**。
   *
   * 它高出地面 0.9 m，但在等角視角下講這件事的只有側面那一道細邊，而那道邊
   * 多半被站房與雨遮擋著。明度一樣的話，月台就只是地上一塊顏色相同的方形。
   *
   * 這與四座池在灰色的地面色譜上變成四個黑洞（BUG-243）是同一類：`shade`
   * 是對的、色譜也是對的，錯在與旁邊那一塊分不開。
   */
  it('should tell the platform apart from the paving around it', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    const paving = trainStationPlan.decals
      .filter(d => (d.layer ?? 'base') === 'base')
      .map(d => d.shade ?? 0);
    for (const s of paving) {
      expect(Math.abs(platform.shade! - s), `月台與鋪面同樣是 ${s} 的灰`)
        .toBeGreaterThan(0.1);
    }
  });

  /**
   * 架高的東西的頂面上不能用標線層。
   *
   * `layer: 'mark'` 貼著**地面**。月台高 0.9 m，所以畫在月台範圍裡的黃線會
   * 落在月台腳邊的碴床上 —— 位置對、高度差了一整個月台。
   */
  it('should not paint markings where the platform stands', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    for (const d of trainStationPlan.decals) {
      if ((d.layer ?? 'base') !== 'mark') continue;
      const onIt = Math.abs(d.x - platform.x) < (d.w + platform.w) / 2
        && Math.abs(d.z - platform.z) < (d.d + platform.d) / 2;
      expect(onIt, '標線畫在月台的範圍裡 —— 它會落在月台腳邊').toBe(false);
    }
    // 月台面上的那一道邊緣帶要真的站在月台頂上。
    const edge = trainStationPlan.props.find(v => v.tag === 'platformEdge')!;
    expect(edge, '月台沒有邊緣警示帶').toBeTruthy();
    expect(edge.y0, '邊緣帶沒有壓在月台面上').toBeCloseTo(platform.y1, 9);
  });

  /**
   * 電車線：**唯一跨過軌道的東西**。
   *
   * 火車站蓋在軌道**上**（`canPlaceTransportStop` 要求 `railType ≠ 0`，而
   * `placeTransportStopOnGrid` 不動 railType），所以真的鋼軌會從這一格的
   * 格心穿過去 —— 那條軌道由 `TrackRenderer` 畫，這一格自己不畫。
   *
   * 站房與月台都退到軌道的一側之後，這一格裡就沒有任何東西在講「軌道從
   * 這裡穿過去」了。電車線補的正是這件事：柱子站在月台邊，懸臂伸過軌道
   * 上方，接觸線沿著軌道走滿整格。
   *
   * 而它也是走廊那條驗收裡唯一走 `above` 分支的東西 —— 走廊是**淨空包絡線**
   * 不是禁建區，`TRACK_CLEARANCE` 取的就是電氣化路線的建築限界。
   */
  it('should hang the catenary over the track', () => {
    const masts = trainStationPlan.props.filter(v => v.tag === 'catenaryMast');
    const arms = trainStationPlan.props.filter(v => v.tag === 'cantilever');
    const wires = trainStationPlan.props.filter(v => v.tag === 'contactWire');
    const platform = tagged(trainStationPlan, 'platform')[0]!;

    expect(masts.length, '電車線的柱子不夠').toBeGreaterThanOrEqual(3);
    for (const p of masts) {
      // 站在月台上，而且讓開走廊 —— 柱子沒有「跨過去」這個選項。
      expect(p.y0, '柱子沒有站在月台上').toBeCloseTo(platform.y1, 9);
      expect(Math.abs(p.z) - p.d / 2, '柱子站在軌道上')
        .toBeGreaterThanOrEqual(TRACK_WIDTH - 1e-9);
    }

    expect(arms.length, '懸臂不夠').toBeGreaterThanOrEqual(3);
    for (const a of arms) {
      // 真的伸過軌道，而且高過建築限界。
      expect(a.z - a.d / 2, '懸臂沒有伸到軌道上方').toBeLessThan(0);
      expect(a.y0, '懸臂低於建築限界 —— 列車會撞到')
        .toBeGreaterThanOrEqual(TRACK_CLEARANCE - 1e-9);
    }

    expect(wires.length, '沒有接觸線').toBeGreaterThan(0);
    for (const w of wires) {
      expect(Math.max(...w.color!), '接觸線不是黑的').toBeLessThan(0.15);
      expect(w.y0, '接觸線低於建築限界')
        .toBeGreaterThanOrEqual(TRACK_CLEARANCE - 1e-9);
      // 沿著軌道走滿整格 —— 只有一小段的話那是一根掛在空中的棒子。
      expect(m(w.w), '接觸線太短').toBeGreaterThan(10);
      expect(Math.abs(w.z), '接觸線沒有走在軌道正上方').toBeLessThan(TRACK_WIDTH);
    }
  });

  /**
   * 月台上要有**人用得到的東西**。
   *
   * 一塊空鋪面加一道雨遮讀起來是騎樓。長椅、垃圾桶與時刻表是「這裡有人在
   * 等車」的訊號，而那正是月台與人行道的差別。
   *
   * 全部走 `props` 而不是 `fixtures`：地面物件站在 y = 0，放在月台的位置上
   * 會有一半埋在月台裡。
   */
  it('should furnish the platform for people waiting on it', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    const kit = trainStationPlan.props.filter(v =>
      /bench|platformBin|timetable/.test(v.tag ?? ''));
    expect(kit.length, '月台上什麼都沒有').toBeGreaterThanOrEqual(4);
    for (const v of kit) {
      expect(v.y0, `${v.tag} 埋在月台裡或浮在空中`)
        .toBeGreaterThanOrEqual(platform.y1 - 1e-9);
      const onDeck = Math.abs(v.x - platform.x) + v.w / 2 <= platform.w / 2 + 1e-9
        && Math.abs(v.z - platform.z) + v.d / 2 <= platform.d / 2 + 1e-9;
      expect(onDeck, `${v.tag} 站到月台外面去了`).toBe(true);
    }
    expect(trainStationPlan.props.some(v => v.tag === 'bench'), '月台沒有長椅')
      .toBe(true);
  });

  it('should stand a lit signal at the end of the platform', () => {
    // 號誌機是「這是鐵路」最短的一句話。燈頭會亮 —— 夜裡它是月台盡頭那一點紅。
    const head = trainStationPlan.props.find(v => v.tag === 'signalHead')!;
    const mast = trainStationPlan.props.find(v => v.tag === 'signalMast')!;
    expect(head, '沒有號誌機').toBeTruthy();
    expect(head.part, '號誌燈不會亮').toBe(PART_LAMP);
    expect(head.y0, '燈頭沒有裝在桿上').toBeGreaterThan(mast.y0);
    expect(head.y1, '燈頭高過桿頂').toBeLessThanOrEqual(mast.y1 + 1e-9);
  });

  it('should hang a lit clock on the front', () => {
    const clock = tagged(trainStationPlan, 'clock')[0]!;
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    expect(clock.part, '大鐘不會亮').toBe(PART_LAMP);
    // 掛在**朝月台**那一面。站房移到月台上之後這一面才是它的正面：等車的人
    // 與進站的列車看到的都是它，而背面朝著街道那一側只有一道山牆。
    expect(clock.z + clock.d / 2, '大鐘埋在牆裡')
      .toBeLessThanOrEqual(hall.z - hall.d / 2 + 1e-9);
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

  it('should roof the whole open half of the platform', () => {
    // 月台就是一道雨遮。只蓋住一小段的話，剩下那一大片空鋪面讀起來是廣場。
    const canopy = trainStationPlan.overhead.find(v => v.tag === 'platformCanopy')!;
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(canopy, '月台沒有雨遮').toBeTruthy();
    // 從月台的一端一路蓋到站房的牆邊 —— 中間斷開的話那是兩塊棚子。
    expect(canopy.x - canopy.w / 2, '雨遮沒有蓋到月台的端點')
      .toBeCloseTo(platform.x - platform.w / 2, 6);
    expect(canopy.x + canopy.w / 2, '雨遮與站房之間留了一段沒蓋')
      .toBeGreaterThanOrEqual(hall.x - hall.w / 2 - 1e-9);
  });
});

describe('渡輪碼頭', () => {
  const quay = tagged(ferryDockPlan, 'quay')[0]!;
  const EDGE = 0.5;   // 佔地前緣（格）＝ 岸線

  /**
   * 泊位**空著**。
   *
   * 這與公車站是同一條理由：城市裡的渡輪是 `FerryAnimator` 開著的真船，
   * 會照航線靠泊 —— 碼頭邊再擺
   * 一艘不會動的，就變成一艘永遠佔著泊位的船擋住真的那艘。
   *
   * 而且水在**隔壁那一格**（`isShorePosition`：這一格是陸地，四鄰有一格是
   * 水），所以靜態的船只能停在佔地前緣的鋪面上 —— 在展示區裡它讀起來是
   * 一艘擱淺的船。
   *
   * 船拿掉之後，「這裡是碼頭」要由碼頭自己講：甲板、雨棚、跳板、繫纜樁、
   * 標誌燈。下面那幾條就是在守這件事。
   */
  it('should leave the berth for the ferries that actually sail', () => {
    expect(ferryDockPlan.vehicles, '泊位上停了一艘不會動的船').toEqual([]);
  });

  it('should shelter the berth with a canopy on posts', () => {
    // 空的甲板是一塊鋪面。雨棚是「旅客在這裡等船」的訊號 —— 它撐起了
    // 船拿掉之後這一格最大的一塊空白。
    const canopy = ferryDockPlan.overhead.find(v => v.tag === 'berthCanopy')!;
    const posts = ferryDockPlan.props.filter(v => v.tag === 'canopyPost');
    expect(canopy, '泊位沒有雨棚').toBeTruthy();
    expect(posts.length, '雨棚沒有柱子').toBeGreaterThanOrEqual(4);
    for (const p of posts) {
      expect(p.y0, '柱子沒有站在甲板上').toBeCloseTo(quay.y1, 9);
      expect(p.y1, '柱子沒有頂到雨棚').toBeCloseTo(canopy.y0, 9);
      // 而且要**站在甲板上** —— 懸在甲板外的柱子是插在水裡的。
      expect(Math.abs(p.x), `柱子 x=${p.x} 站到甲板外了`)
        .toBeLessThanOrEqual(quay.w / 2);
      expect(Math.abs(p.z - quay.z), `柱子 z=${p.z} 站到甲板外了`)
        .toBeLessThanOrEqual(quay.d / 2);
    }
  });

  /**
   * 這一格裡**沒有水**。
   *
   * 與抽水廠同理：蓋在陸地上的東西不要自己畫水。
   * 而這裡比抽水廠更明確：`Game.placeTransportStop` 用 `isShorePosition`
   * 檢查，那個函式的定義就是「**這一格是陸地**，而且四鄰有一格是水」。
   *
   * 自己畫一片港池的下場與火車站畫假鐵軌一樣：兩份各說各話的水，而且永遠
   * 不會對齊 —— 地形的水在哪裡由地圖決定。
   */
  it('should not paint water of its own', () => {
    for (const d of ferryDockPlan.decals) {
      expect(d.water, `${d.tag ?? '一塊貼片'} 在碼頭裡畫了水`).toBeFalsy();
      expect(d.lawn, '碼頭鋪了草地').toBeFalsy();
    }
  });

  it('should build the quay right up to the shoreline', () => {
    expect(quay.part, '碼頭甲板會長出窗戶').toBe(PART_GROUND);
    expect(quay.shade!, '甲板與柏油一樣暗 —— 看不出有甲板').toBeGreaterThan(0.2);
    expect(m(quay.y1 - quay.y0), '甲板與地面齊平 —— 那是一塊鋪面')
      .toBeGreaterThan(0.4);
    // 甲板要靠在岸線那一側，不是縮在基地中間。
    expect(m(EDGE - (quay.z + quay.d / 2)), '甲板離岸線太遠').toBeLessThan(4);
  });

  it('should hang a gangway off the front of the quay', () => {
    // 少了跳板，船只是停在旁邊的一個物件；有了它，這一格在講「從這裡上船」。
    const ramp = ferryDockPlan.props.find(v => v.tag === 'gangway')!;
    expect(ramp, '沒有跳板').toBeTruthy();
    expect(ramp.z + ramp.d / 2, '跳板沒有伸出甲板')
      .toBeGreaterThan(quay.z + quay.d / 2);
    expect(m(ramp.y1), '跳板高過甲板面 —— 上船要先爬上去')
      .toBeLessThanOrEqual(m(quay.y1) + 1e-9);
  });

  it('should light the end of the quay', () => {
    // 標誌燈是碼頭夜裡唯一的東西。
    const light = tagged(ferryDockPlan, 'navLight')[0]!;
    expect(light.part).toBe(PART_LAMP);
    expect(light.z, '標誌燈不在水邊').toBeGreaterThan(quay.z - quay.d / 2);
  });

  it('should give the ferry something to tie up to', () => {
    // 船不停在這裡了，繫纜樁反而更重要 —— 它是空甲板上唯一在說
    // 「這條邊會靠船」的東西。
    const moorings = ferryDockPlan.props.filter(v => v.tag === 'mooring');
    expect(moorings.length, '沒有繫纜樁').toBeGreaterThanOrEqual(3);
    for (const v of moorings) {
      expect(v.y0, '繫纜樁沉在甲板裡').toBeCloseTo(quay.y1, 9);
      // 排在**靠岸線那一半**的甲板上。散在甲板中間的話那是幾根路障。
      expect(v.z, `繫纜樁 z=${v.z} 排在甲板內側`).toBeGreaterThan(quay.z);
    }
  });
});

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
 * The four transit stops. Their shared acceptance checks live in the table in
 * `CivicPlans.test.ts`.
 *
 * All four are 1x1, the tightest scale in the project, with only +/-5.76 m of usable range.
 * Hence one set of checks the other batches do not need: **does anything actually fit**.
 */
describe.each(PLANS)('%s', (_label, plan, type) => {
  it('should use the transit facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_TRANSIT);
    expect(plan.color).toEqual(civicColorOf(type));
    expect(plan.footprint).toEqual({ w: 1, h: 1 });
  });

  /**
   * On 1x1, `CIVIC_INSET` takes several times the share it takes elsewhere.
   *
   * A 2x2 plot loses 2% to 0.02 cells; a 1x1 loses 4%, and on a 12 m plot that 0.48 m really
   * can leave a shelter with nowhere to stand. This measures what is left: down to a few
   * centimetres, the next small adjustment hits the wall with an error message that only says
   * "outside the footprint".
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
   * The glowing totem.
   *
   * It is the night vocabulary the four share, and the only "bright" a 12 m plot can hold.
   * Without it, a station at night is indistinguishable from empty land.
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
    // In `props` it is dropped wholesale at distant LOD, which is exactly the range where it
    // matters most.
    expect(plan.massing.some(v => v.tag === 'totem'), '識別柱會被遠景關掉')
      .toBe(true);
  });

  it('should give every raised paving an actual shade', () => {
    // Platforms, decks and stair mouths all take `PART_GROUND`. Without `shade` the B channel
    // is 0, which is asphalt black rather than the intended colour, and nothing reports it.
    for (const v of plan.massing.filter(v => v.part === PART_GROUND)) {
      expect(v.shade, `${v.tag} 是 PART_GROUND 卻沒有明度`).toBeDefined();
    }
  });

  it('should stay low enough not to overshadow a 12 m plot', () => {
    // A 15 m building on a 12 m plot hides two rows of houses behind it in an isometric view.
    const top = m(topOf(plan.massing));
    expect(top, `${type} 蓋到 ${top.toFixed(1)} m`).toBeLessThan(12);
  });
});

describe('公車站', () => {
  it('should shelter the bench under a roof on posts', () => {
    // A shelter walled on four sides cannot see the bus coming. One back panel, two front
    // posts, one roof.
    const posts = busStopPlan.props.filter(v => v.tag === 'post');
    const roof = busStopPlan.overhead.find(v => v.tag === 'shelterRoof')!;
    const back = tagged(busStopPlan, 'backPanel')[0]!;
    expect(posts.length, '候車亭沒有前柱').toBe(2);
    expect(roof, '候車亭沒有頂').toBeTruthy();
    expect(back, '候車亭沒有背板').toBeTruthy();
    for (const p of posts) expect(p.y1, '柱子沒有頂到頂棚').toBeCloseTo(roof.y0, 9);
    expect(back.y1, '背板沒有接到頂棚').toBeCloseTo(roof.y0, 9);
    // The bench belongs under the roof.
    const bench = busStopPlan.props.find(v => v.tag === 'bench')!;
    expect(Math.abs(bench.z - roof.z), '長椅淋得到雨')
      .toBeLessThanOrEqual(roof.d / 2);
  });

  /**
   * **No** static bus at the stop.
   *
   * The city's buses are real vehicles driven by `VehicleRenderer` and stop here on their
   * routes; a static one would be a bus permanently parked in front of the real one.
   *
   * This differs from a fire station's engine or an airport's aircraft: those **normally sit on
   * the plot**, while a bus is normally on the road.
   */
  it('should leave the bay for the buses that actually drive', () => {
    expect(busStopPlan.vehicles, '站牌前擺了一台不會動的公車').toEqual([]);
  });

  it('should still mark the bay so it reads as a stop', () => {
    // No vehicle, but the bay and its yellow line stay: they are what says "this is a stop".
    const bay = busStopPlan.decals.find(d =>
      (d.layer ?? 'base') === 'base' && d.shade < 0.2);
    expect(bay, '沒有停靠彎').toBeTruthy();
    expect(busStopPlan.decals.some(d => d.layer === 'mark' && d.shade > 0.7),
      '停靠彎沒有標線').toBe(true);
  });
});

describe('捷運站', () => {
  it('should show that there is a hole in the ground', () => {
    // The dark stair mouth is the only signal that there is an opening here; without it the
    // entrance is a small box indistinguishable from a substation cabinet.
    const mouth = tagged(metroStationPlan, 'stairMouth')[0]!;
    expect(mouth, '沒有階梯口').toBeTruthy();
    expect(mouth.part).toBe(PART_GROUND);
    expect(mouth.shade!, '階梯口不夠暗，看起來像鋪面').toBeLessThan(0.15);
  });

  /**
   * Descendable from all four sides.
   *
   * It has to read as a concourse you can go down from any direction. The question is whether
   * **each** of the four directions has an entrance, not whether there are four entrances:
   * four crowded onto one side is also four.
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
    // With the four mouths huddled against the concourse, "four ways down" is a lie: someone
    // walking up to it finds only a dark patch of ground. Each has to run from the concourse
    // wall out to the sidewalk.
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
    // An opening with no railings is a stain on the ground.
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
    // The only one of the four with a station building, so it is the tallest — but under 8 m:
    // on a 12 m plot, anything higher shows more facade than roof in an isometric view and
    // reads as a tower.
    const top = topOf(trainStationPlan.massing);
    for (const [, other] of PLANS.filter(([, p]) => p !== trainStationPlan)) {
      expect(top, '火車站不是最高的').toBeGreaterThan(topOf(other.massing));
    }
    expect(m(top), `站房蓋到 ${m(top).toFixed(1)} m`).toBeLessThan(8);
  });

  /**
   * The train station draws no rails of its own and keeps clear of the real one.
   *
   * Stronger than "built beside the rail": `canPlaceTransportStop` requires a train station to
   * stand **on** a cell whose `railType != 0`, and `placeTransportStopOnGrid` only changes
   * buildingId / reserved / zoneType, so the track stays in the cell and `TrackRenderer` still
   * draws ballast, sleepers and rails hugging the **cell centre**.
   *
   * So this guards two things: no rails of its own, which would sit apart from the real ones,
   * and nothing built on top of them, which a train would drive through. The corridor width is
   * taken straight from `TrackRenderer`'s `TRACK_WIDTH`; a copied number would not learn about
   * a change there.
   */
  it('should leave the real track a clear corridor', () => {
    expect(trainStationPlan.props.filter(v => v.tag === 'rail').length,
      '火車站自己畫了鋼軌 —— TrackRenderer 已經在同一格畫過了').toBe(0);

    const half = TRACK_WIDTH;   // twice the ballast half-width: a carriage is wider than the gauge
    const all = [
      ...trainStationPlan.massing, ...trainStationPlan.props,
      ...trainStationPlan.overhead,
    ];
    for (const v of all) {
      const aside = v.z - v.d / 2 >= half - 1e-9 || v.z + v.d / 2 <= -half + 1e-9;
      // Crossing is allowed, provided it clears **high enough**. The corridor is a clearance
      // envelope, not a no-build zone: footbridges and overtrack halls sit above the rails, and
      // as a no-build zone a train station could only ever be two disconnected buildings on
      // either side.
      const above = v.y0 >= TRACK_CLEARANCE - 1e-9;
      expect(aside || above,
        `${v.tag} 蓋在軌道走廊上，而且沒有跨過去的淨空`).toBe(true);
    }
    // Things on the ground have no "cross above" option.
    for (const f of trainStationPlan.fixtures) {
      const e = propExtent(f);
      const clear = f.z - e.z >= half - 1e-9 || f.z + e.z <= -half + 1e-9;
      expect(clear, `${f.kind} 站在軌道走廊上`).toBe(true);
    }
  });

  /**
   * The hall **stands on the platform**.
   *
   * A hall on one side of the track with a platform on the other leaves two separate objects
   * that read as a house with a platform beside it, and a footbridge joining them fills a 12 m
   * plot with stair towers and railings and cuts the platform in two.
   *
   * A small real station does not cross the line: the hall stands on the platform, and the
   * platform is the paving beside it plus a canopy. Both sit on the same side of the track and
   * the hall's underside **is** the platform's top surface, so joining them needs no structure
   * — they are one deck already.
   */
  it('should stand the hall on the platform, not across the track', () => {
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;

    expect(tagged(trainStationPlan, 'footbridge').length, '天橋還在').toBe(0);
    expect(tagged(trainStationPlan, 'stairTower').length, '樓梯塔還在').toBe(0);

    // The same side; across the track they could never join.
    expect(Math.sign(hall.z), '站房與月台隔著軌道')
      .toBe(Math.sign(platform.z));
    // The hall's underside sits on the platform surface.
    expect(hall.y0, '站房沒有坐在月台上').toBeCloseTo(platform.y1, 9);
    // And the whole building stays within the platform, or one corner hangs in the air.
    expect(hall.x - hall.w / 2, '站房的一角伸出月台外')
      .toBeGreaterThanOrEqual(platform.x - platform.w / 2 - 1e-9);
    expect(hall.x + hall.w / 2).toBeLessThanOrEqual(platform.x + platform.w / 2 + 1e-9);
    expect(hall.z - hall.d / 2)
      .toBeGreaterThanOrEqual(platform.z - platform.d / 2 - 1e-9);
    expect(hall.z + hall.d / 2).toBeLessThanOrEqual(platform.z + platform.d / 2 + 1e-9);
  });

  /**
   * Both sides of the track are platforms.
   *
   * A track running through can be boarded from either side, and building only one leaves the
   * other as a forecourt cut off across the rails with no way to reach it, since a footbridge
   * does not fit on 12 m. One platform per side is the only use of this plot that holds up.
   *
   * The two buildings sit **diagonally**: the main hall at one side's east end, the waiting
   * room at the other side's west end. Mirrored, both sides would read as one drawing pasted
   * twice, while real double-sided platforms are uneven anyway.
   */
  it('should serve both sides of the track', () => {
    const main = tagged(trainStationPlan, 'platform')[0]!;
    const far = tagged(trainStationPlan, 'sidePlatform')[0]!;
    expect(far, '對側沒有月台').toBeTruthy();
    expect(Math.sign(far.z), '兩座月台在軌道的同一側')
      .not.toBe(Math.sign(main.z));
    expect(far.part, '對側月台不是鋪面').toBe(PART_GROUND);
    expect(far.y1, '兩座月台不一樣高').toBeCloseTo(main.y1, 9);
    expect(m(far.w), '對側月台太短，停不下一節車廂').toBeGreaterThan(10);
    // Clear of the corridor: a platform has no "cross above" option.
    expect(Math.abs(far.z) - far.d / 2, '對側月台壓在軌道上')
      .toBeGreaterThanOrEqual(TRACK_WIDTH - 1e-9);

    // The far side needs its own waiting room, set **diagonally** from the main hall; at the
    // same end the two crowd together and leave a large gap at the other.
    const shelter = tagged(trainStationPlan, 'shelter')[0]!;
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    expect(shelter, '對側沒有候車室').toBeTruthy();
    expect(shelter.y0, '候車室沒有坐在對側月台上').toBeCloseTo(far.y1, 9);
    expect(Math.sign(shelter.x), '候車室與站房擠在同一端')
      .not.toBe(Math.sign(hall.x));
    expect(shelter.y1, '候車室比主站房還高').toBeLessThan(hall.y1);
  });

  it('should leave the platform room to stand on beside the hall', () => {
    // A hall covering the whole platform makes it not a platform but a house on a deck.
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
    // And it runs the full cell along the track; a short stretch is a step.
    expect(m(platform.w), '月台太短，停不下一節車廂').toBeGreaterThan(10);
  });

  /**
   * The platform has to read **apart from** the paving beside it.
   *
   * It stands 0.9 m above the ground, but in an isometric view only a thin side edge says so,
   * and that edge is mostly hidden by the hall and the canopy. At equal brightness the platform
   * is just a same-coloured square on the ground.
   *
   * The same class of fault as four basins turning into four black holes on the grey ground
   * ramp (BUG-243): the `shade` is right and the ramp is right, and the fault is that it cannot
   * be told apart from what is next to it.
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
   * The marking layer cannot be used on top of anything raised.
   *
   * `layer: 'mark'` hugs the **ground**. The platform is 0.9 m up, so a yellow line drawn within
   * the platform's extent lands on the ballast at its foot: the right position, a whole
   * platform's height wrong.
   */
  it('should not paint markings where the platform stands', () => {
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    for (const d of trainStationPlan.decals) {
      if ((d.layer ?? 'base') !== 'mark') continue;
      const onIt = Math.abs(d.x - platform.x) < (d.w + platform.w) / 2
        && Math.abs(d.z - platform.z) < (d.d + platform.d) / 2;
      expect(onIt, '標線畫在月台的範圍裡 —— 它會落在月台腳邊').toBe(false);
    }
    // The edge strip on the platform has to actually sit on the platform's top.
    const edge = trainStationPlan.props.find(v => v.tag === 'platformEdge')!;
    expect(edge, '月台沒有邊緣警示帶').toBeTruthy();
    expect(edge.y0, '邊緣帶沒有壓在月台面上').toBeCloseTo(platform.y1, 9);
  });

  /**
   * The catenary: **the only thing that crosses the track**.
   *
   * A train station is built **on** the track (`canPlaceTransportStop` requires
   * `railType != 0`, and `placeTransportStopOnGrid` leaves railType alone), so the real rails
   * run through the cell centre, drawn by `TrackRenderer` rather than by this model.
   *
   * With the hall and both platforms set back to the sides, nothing on the cell says the track
   * runs through here. The catenary supplies that: masts along the platform edge, cantilevers
   * over the track, and a contact wire running the full cell along the rails.
   *
   * It is also the only thing here that takes the `above` branch of the corridor check: the
   * corridor is a **clearance envelope**, not a no-build zone, and `TRACK_CLEARANCE` is the
   * structure gauge for an electrified line.
   */
  it('should hang the catenary over the track', () => {
    const masts = trainStationPlan.props.filter(v => v.tag === 'catenaryMast');
    const arms = trainStationPlan.props.filter(v => v.tag === 'cantilever');
    const wires = trainStationPlan.props.filter(v => v.tag === 'contactWire');
    const platform = tagged(trainStationPlan, 'platform')[0]!;

    expect(masts.length, '電車線的柱子不夠').toBeGreaterThanOrEqual(3);
    for (const p of masts) {
      // Standing on the platform and clear of the corridor: a mast has no "cross above"
      // option.
      expect(p.y0, '柱子沒有站在月台上').toBeCloseTo(platform.y1, 9);
      expect(Math.abs(p.z) - p.d / 2, '柱子站在軌道上')
        .toBeGreaterThanOrEqual(TRACK_WIDTH - 1e-9);
    }

    expect(arms.length, '懸臂不夠').toBeGreaterThanOrEqual(3);
    for (const a of arms) {
      // Actually reaching over the track, and above the structure gauge.
      expect(a.z - a.d / 2, '懸臂沒有伸到軌道上方').toBeLessThan(0);
      expect(a.y0, '懸臂低於建築限界 —— 列車會撞到')
        .toBeGreaterThanOrEqual(TRACK_CLEARANCE - 1e-9);
    }

    expect(wires.length, '沒有接觸線').toBeGreaterThan(0);
    for (const w of wires) {
      expect(Math.max(...w.color!), '接觸線不是黑的').toBeLessThan(0.15);
      expect(w.y0, '接觸線低於建築限界')
        .toBeGreaterThanOrEqual(TRACK_CLEARANCE - 1e-9);
      // Running the full cell along the track; a short stretch is a rod hanging in the air.
      expect(m(w.w), '接觸線太短').toBeGreaterThan(10);
      expect(Math.abs(w.z), '接觸線沒有走在軌道正上方').toBeLessThan(TRACK_WIDTH);
    }
  });

  /**
   * The platform carries **things people can use**.
   *
   * Bare paving under a canopy reads as an arcade. Benches, bins and a timetable are the signal
   * that people wait here, and that is the difference between a platform and a sidewalk.
   *
   * All through `props` rather than `fixtures`: ground props stand at y = 0 and would be
   * half-buried at platform height.
   */
  it('should furnish the platform for people waiting on it', () => {
    const decks = [
      tagged(trainStationPlan, 'platform')[0]!,
      tagged(trainStationPlan, 'sidePlatform')[0]!,
    ];
    const kit = trainStationPlan.props.filter(v =>
      /bench|platformBin|timetable/.test(v.tag ?? ''));
    expect(kit.length, '月台上什麼都沒有').toBeGreaterThanOrEqual(4);
    for (const v of kit) {
      // Either platform counts, but each item has to land on **one** of them, not on their
      // union.
      const deck = decks.find(p =>
        Math.abs(v.x - p.x) + v.w / 2 <= p.w / 2 + 1e-9
        && Math.abs(v.z - p.z) + v.d / 2 <= p.d / 2 + 1e-9);
      expect(deck, `${v.tag} 站到月台外面去了`).toBeTruthy();
      expect(v.y0, `${v.tag} 埋在月台裡或浮在空中`)
        .toBeGreaterThanOrEqual(deck!.y1 - 1e-9);
    }
    expect(trainStationPlan.props.some(v => v.tag === 'bench'), '月台沒有長椅')
      .toBe(true);
  });

  it('should stand a lit signal at the end of the platform', () => {
    // The signal is the shortest way to say "this is a railway". Its head glows: at night it is
    // the point of red at the platform's end.
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
    // On the face **toward the platform**. With the hall on the platform that is its front,
    // seen by people waiting and by an arriving train, while the street side is only a gable.
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
    // A platform is a canopy. Covering only a short stretch leaves a large area of bare paving
    // that reads as a plaza.
    const canopy = trainStationPlan.overhead.find(v => v.tag === 'platformCanopy')!;
    const hall = tagged(trainStationPlan, 'hall')[0]!;
    const platform = tagged(trainStationPlan, 'platform')[0]!;
    expect(canopy, '月台沒有雨遮').toBeTruthy();
    // From the platform's end all the way to the hall's wall; broken in the middle it is two
    // separate roofs.
    expect(canopy.x - canopy.w / 2, '雨遮沒有蓋到月台的端點')
      .toBeCloseTo(platform.x - platform.w / 2, 6);
    expect(canopy.x + canopy.w / 2, '雨遮與站房之間留了一段沒蓋')
      .toBeGreaterThanOrEqual(hall.x - hall.w / 2 - 1e-9);
  });
});

describe('渡輪碼頭', () => {
  const quay = tagged(ferryDockPlan, 'quay')[0]!;
  const EDGE = 0.5;   // the plot front edge in cells, which is the shoreline

  /**
   * The berth stays **empty**.
   *
   * Same reason as the bus stop: the city's ferries are real vessels driven by `FerryAnimator`
   * and berth here on their routes, so a static one would occupy the berth permanently in front
   * of the real one.
   *
   * The water is also on the **neighbouring cell** (`isShorePosition`: this cell is land and one
   * of its four neighbours is water), so a static boat could only sit on the paving at the
   * plot's front edge, reading in the showcase as run aground.
   *
   * With no boat, the quay itself has to say "this is a terminal": deck, canopy, gangway,
   * bollards, navigation light. The cases below guard exactly that.
   */
  it('should leave the berth for the ferries that actually sail', () => {
    expect(ferryDockPlan.vehicles, '泊位上停了一艘不會動的船').toEqual([]);
  });

  it('should shelter the berth with a canopy on posts', () => {
    // A bare deck is paving. The canopy is the signal that passengers wait here for a boat, and
    // it holds up the largest empty area on the cell.
    const canopy = ferryDockPlan.overhead.find(v => v.tag === 'berthCanopy')!;
    const posts = ferryDockPlan.props.filter(v => v.tag === 'canopyPost');
    expect(canopy, '泊位沒有雨棚').toBeTruthy();
    expect(posts.length, '雨棚沒有柱子').toBeGreaterThanOrEqual(4);
    for (const p of posts) {
      expect(p.y0, '柱子沒有站在甲板上').toBeCloseTo(quay.y1, 9);
      expect(p.y1, '柱子沒有頂到雨棚').toBeCloseTo(canopy.y0, 9);
      // And **standing on the deck**: a post hanging past its edge stands in the water.
      expect(Math.abs(p.x), `柱子 x=${p.x} 站到甲板外了`)
        .toBeLessThanOrEqual(quay.w / 2);
      expect(Math.abs(p.z - quay.z), `柱子 z=${p.z} 站到甲板外了`)
        .toBeLessThanOrEqual(quay.d / 2);
    }
  });

  /**
   * There is **no water** on this cell.
   *
   * The same rule as the water plant: something built on land does not draw its own water. It is
   * more explicit here — `Game.placeTransportStop` checks `isShorePosition`, whose definition is
   * "**this cell is land**, and one of its four neighbours is water".
   *
   * Drawing a basin ends the way a train station's fake rails would: two versions of the same
   * thing that never line up, because where terrain water lies is decided by the map.
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
    // The deck sits toward the shoreline, not tucked into the middle of the plot.
    expect(m(EDGE - (quay.z + quay.d / 2)), '甲板離岸線太遠').toBeLessThan(4);
  });

  it('should hang a gangway off the front of the quay', () => {
    // Without a gangway a boat is just an object moored nearby; with one, the cell says "board
    // here".
    const ramp = ferryDockPlan.props.find(v => v.tag === 'gangway')!;
    expect(ramp, '沒有跳板').toBeTruthy();
    expect(ramp.z + ramp.d / 2, '跳板沒有伸出甲板')
      .toBeGreaterThan(quay.z + quay.d / 2);
    expect(m(ramp.y1), '跳板高過甲板面 —— 上船要先爬上去')
      .toBeLessThanOrEqual(m(quay.y1) + 1e-9);
  });

  it('should light the end of the quay', () => {
    // The navigation light is the only thing on the quay at night.
    const light = tagged(ferryDockPlan, 'navLight')[0]!;
    expect(light.part).toBe(PART_LAMP);
    expect(light.z, '標誌燈不在水邊').toBeGreaterThan(quay.z - quay.d / 2);
  });

  it('should give the ferry something to tie up to', () => {
    // With no boat at the berth the bollards carry more weight: on an empty deck they are the
    // only thing saying a vessel comes alongside this edge.
    const moorings = ferryDockPlan.props.filter(v => v.tag === 'mooring');
    expect(moorings.length, '沒有繫纜樁').toBeGreaterThanOrEqual(3);
    for (const v of moorings) {
      expect(v.y0, '繫纜樁沉在甲板裡').toBeCloseTo(quay.y1, 9);
      // Set on the **shoreward half** of the deck; scattered across its middle they read as
      // traffic barriers.
      expect(v.z, `繫纜樁 z=${v.z} 排在甲板內側`).toBeGreaterThan(quay.z);
    }
  });
});

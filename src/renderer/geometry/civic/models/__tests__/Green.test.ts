import { describe, it, expect } from 'vitest';
import { parkPlan } from '../park';
import { cemeteryPlan } from '../cemetery';
import {
  FACADE_GREEN, PART_GROUND, PART_LAMP, PART_ROOF,
} from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicDecal, CivicPlan } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const base = (p: CivicPlan) => p.decals.filter(d => (d.layer ?? 'base') === 'base');
const area = (d: CivicDecal) => d.w * d.d;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);

/**
 * 綠地兩種：公園與墓園。共通的驗收在 `CivicPlans.test.ts` 的資料表裡。
 *
 * 它們共用 `FACADE_GREEN` —— 那條立面分支**刻意沒有窗格**。綠地上的量體是
 * 涼亭與禮拜堂，長滿窗戶的涼亭看起來只會像一個很小的辦公室。
 */
describe.each([
  ['公園', parkPlan, 'park'],
  ['墓園', cemeteryPlan, 'cemetery'],
] as const)('%s', (_label, plan, type) => {
  it('should use the green facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_GREEN);
    expect(plan.color).toEqual(civicColorOf(type));
  });

  it('should be mostly grass', () => {
    // 綠地的地就是它的內容。鋪面過半的話那是一座廣場，不是綠地。
    const all = base(plan).reduce((s, d) => s + area(d), 0);
    const grass = base(plan).filter(d => d.lawn).reduce((s, d) => s + area(d), 0);
    expect(grass / all, `${type} 的草地只佔 ${(grass / all * 100).toFixed(0)}%`)
      .toBeGreaterThan(0.5);
  });

  it('should let people walk in', () => {
    // 有一條鋪面要通到格子邊界。四面都是草的綠地是一塊裝飾用的草皮 ——
    // 而且遊戲裡它就緊貼著馬路。
    const edge = plan.footprint.h / 2;
    const reaches = base(plan).some(d => !d.lawn && d.z + d.d / 2 >= edge - 1e-9);
    expect(reaches, `${type} 的步道沒有通到路邊`).toBe(true);
  });

  it('should light something without relying on windows', () => {
    // `FACADE_GREEN` 沒有窗格，所以夜裡的亮點只能來自 `PART_LAMP`。
    // 這一條是 BUG-238 在綠地上的版本。
    const lamps = [...plan.massing, ...plan.props]
      .filter(v => v.part === PART_LAMP).length;
    const street = plan.fixtures.filter(f => f.kind === 'lamp').length;
    expect(lamps + street, `${type} 夜裡是一塊黑地`).toBeGreaterThan(0);
  });

  it('should plant a lot of trees', () => {
    // 綠地的三角形本來就該花在綠化上。
    expect(plan.fixtures.filter(f => f.kind === 'tree').length, `${type} 的樹太少`)
      .toBeGreaterThanOrEqual(6);
  });
});

describe('公園', () => {
  const plan = parkPlan;

  it('should occupy a single cell', () => {
    expect(plan.footprint).toEqual({ w: 1, h: 1 });
  });

  it('should stay small enough not to loom over the houses', () => {
    // 12 m 的格子上蓋一棟樓是不對的。涼亭就是涼亭。
    const top = m(topOf(plan.massing));
    expect(top, `公園蓋到 ${top.toFixed(1)} m`).toBeLessThan(5);
  });

  it('should carry the gazebo roof on posts', () => {
    // 四面牆的話那是一間房，不是涼亭 —— 而且從側面看不進去。
    const posts = plan.props.filter(v => v.tag === 'post');
    const roof = tagged(plan, 'gazeboRoof');
    expect(posts.length, '涼亭的柱子不到三根').toBeGreaterThanOrEqual(3);
    expect(roof.length, '涼亭沒有屋頂').toBeGreaterThan(0);
    for (const r of roof) expect(r.part).toBe(PART_ROOF);
    const eave = Math.min(...roof.map(r => r.y0));
    for (const p of posts) {
      expect(p.y1, '柱子沒有頂到屋簷').toBeCloseTo(eave, 6);
    }
  });

  it('should floor the gazebo with paving, not a wall', () => {
    // 標成牆的話這座 0.25 m 高的台子會長出窗戶。
    const deck = tagged(plan, 'deck')[0]!;
    expect(deck.part).toBe(PART_GROUND);
    expect(deck.shade, '台座沒有鋪面明度').toBeGreaterThan(0);
  });

  it('should light the gazebo itself, not only the paths', () => {
    // 「有東西會亮」由共用路燈就能滿足（資料表那條），但那不是重點：
    // 涼亭是這一格的焦點，夜裡它自己不亮的話，公園在夜景裡是兩支路燈中間
    // 的一塊黑。
    const own = [...plan.massing, ...plan.props].filter(v => v.part === PART_LAMP);
    expect(own.length, '涼亭自己沒有燈').toBeGreaterThan(0);
    for (const v of own) {
      expect(Math.hypot(v.x, v.z), '亮的東西不在涼亭上').toBeLessThan(0.2);
    }
  });

  it('should offer somewhere to sit', () => {
    expect(plan.props.filter(v => v.tag === 'bench').length, '公園沒有長椅')
      .toBeGreaterThanOrEqual(2);
  });

  it('should not pretend a 12 m park has parking', () => {
    // 一格的公園是走路來的。停一台車就佔掉基地的十分之一。
    expect(plan.vehicles).toEqual([]);
  });

  it('should cross the paths so all four edges connect', () => {
    // 十字步道的四個端點都要通到邊界 —— 只通一邊的話從另外三面走不進來。
    const half = 0.5;
    const paths = base(plan).filter(d => !d.lawn);
    const reaches = (pick: (d: CivicDecal) => number) =>
      paths.some(d => Math.abs(pick(d)) >= half - 1e-9);
    expect(reaches(d => d.x + d.w / 2), '東側走不進來').toBe(true);
    expect(reaches(d => d.x - d.w / 2), '西側走不進來').toBe(true);
    expect(reaches(d => d.z + d.d / 2), '南側走不進來').toBe(true);
    expect(reaches(d => d.z - d.d / 2), '北側走不進來').toBe(true);
  });
});

describe('墓園', () => {
  const plan = cemeteryPlan;
  const stones = plan.props.filter(v => v.tag === 'headstone');

  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
  });

  it('should line the headstones up in a grid', () => {
    // 對齊是這一棟的全部。散落的矮方塊讀起來是「地上有一堆東西」，
    // 排成格線才是墓園。
    expect(stones.length, '墓碑太少，讀不出是墓園').toBeGreaterThanOrEqual(20);
    const key = (v: number) => v.toFixed(6);
    const cols = new Set(stones.map(s => key(s.x)));
    const rows = new Set(stones.map(s => key(s.z)));
    expect(cols.size * rows.size, '墓碑不成格線 —— 有的行列缺角')
      .toBe(stones.length);
    expect(cols.size, '只有一行').toBeGreaterThan(2);
    expect(rows.size, '只有一列').toBeGreaterThan(2);
  });

  /**
   * 而且**等距**。
   *
   * 「成格線」擋不住不等距的格線：把某一列整條往下挪 0.1 m，行列數完全不變
   * —— 上面那條測試是綠的，而畫面上那一列明顯歪掉。等距才是「有人在管理」
   * 的訊號，也是墓園與「地上散了一堆石頭」的差別。
   *
   * 行（x）分成步道左右兩群，各自等距；群與群之間隔著步道，所以整體不等距
   * 是**對的** —— 拿整排一起量會把那道必要的縫判成錯。
   */
  it('should space the rows and columns evenly', () => {
    const gaps = (vs: number[]) => {
      const s = [...new Set(vs)].sort((a, b) => a - b);
      return s.slice(1).map((v, i) => v - s[i]!);
    };
    const rowGaps = gaps(stones.map(s => s.z));
    for (const g of rowGaps) {
      expect(m(g), `列距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(rowGaps[0]!), 6);
    }
    for (const side of [-1, 1]) {
      const colGaps = gaps(stones.filter(s => Math.sign(s.x) === side).map(s => s.x));
      for (const g of colGaps) {
        expect(m(g), `行距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(colGaps[0]!), 6);
      }
    }
  });

  it('should cut every headstone from the same mould', () => {
    for (const s of stones) {
      expect(s.w).toBeCloseTo(stones[0]!.w, 9);
      expect(s.y1).toBeCloseTo(stones[0]!.y1, 9);
    }
    const h = m(stones[0]!.y1 - stones[0]!.y0);
    expect(h, `墓碑有 ${h.toFixed(1)} m 高 —— 那是紀念碑`).toBeLessThan(1.2);
  });

  it('should keep the headstones off the path', () => {
    // 走道上長出墓碑的話，那條路就不通了。
    const path = base(plan).find(d => !d.lawn && d.d > d.w)!;
    for (const s of stones) {
      const clear = Math.abs(s.x) - s.w / 2 >= path.w / 2 - 1e-9;
      expect(clear, `有一顆墓碑站在步道上（x = ${m(s.x).toFixed(1)} m）`).toBe(true);
    }
  });

  it('should walk the path from the gate to the memorial', () => {
    // 走不到頭的步道是一條裝飾線。步道要從基地前緣一路接到紀念碑。
    const plinth = tagged(plan, 'plinth')[0]!;
    const path = base(plan).find(d => !d.lawn && d.d > d.w)!;
    const court = base(plan).find(d => !d.lawn && d !== path)!;
    expect(path.z + path.d / 2, '步道沒有接到門口')
      .toBeGreaterThanOrEqual(plan.footprint.h / 2 - 1e-9);
    // 步道接到碑前廣場，碑站在廣場上 —— 中間斷一段的話那是「走到一半的路」。
    expect(path.z - path.d / 2, '步道與碑前廣場之間斷了一段')
      .toBeLessThanOrEqual(court.z + court.d / 2 + 1e-9);
    expect(Math.abs(plinth.z - court.z) + plinth.d / 2, '紀念碑站在廣場外面')
      .toBeLessThanOrEqual(court.d / 2 + 1e-9);
    expect(Math.abs(plinth.x - court.x) + plinth.w / 2)
      .toBeLessThanOrEqual(court.w / 2 + 1e-9);
  });

  /**
   * 墓園裡沒有房子。
   *
   * 使用者：「墓園的造型，我認為可以在簡單一點，不一定要有建築?」拆掉禮拜堂
   * 之後要有一條擋著它長回來 —— 而「有沒有建築」這件事在資料上就看得出來：
   * **屋頂**。這一棟不該有任何一片 `PART_ROOF`，因為它沒有任何一棟需要蓋頂
   * 的東西。
   *
   * 第二條是尺度：紀念碑最大的一階石台是 3.2 m 見方。留 16 m2 的上限 ——
   * 超過那個尺寸的量體就不是一座碑，是一棟樓。
   */
  it('should not put a building in the graveyard', () => {
    const all = [...plan.massing, ...plan.props, ...plan.overhead];
    for (const v of all) {
      expect(v.part, `${v.tag} 是屋頂 —— 墓園裡不該有需要蓋頂的東西`)
        .not.toBe(PART_ROOF);
    }
    for (const v of plan.massing) {
      const footprint = m(v.w) * m(v.d);
      expect(footprint, `${v.tag} 佔了 ${footprint.toFixed(0)} m2 —— 那是一棟樓`)
        .toBeLessThan(16);
    }
  });

  it('should light a cross on top of the memorial', () => {
    // 夜裡整座墓園只剩這個十字。
    const cross = tagged(plan, 'cross');
    const shaft = tagged(plan, 'shaft')[0]!;
    expect(cross.length, '十字不成形').toBeGreaterThanOrEqual(3);
    for (const c of cross) {
      expect(c.part, '十字不會亮').toBe(PART_LAMP);
      expect(c.y0, '十字掛在石柱下面').toBeGreaterThanOrEqual(shaft.y1 - 1e-9);
    }
    // 而且要看得到 —— 4 m 以下的十字被墓碑旁的樹擋住了。
    expect(m(Math.max(...cross.map(c => c.y1))), '十字太矮').toBeGreaterThan(4.5);
  });

  it('should frame the entrance with piers and a lintel', () => {
    const piers = tagged(plan, 'gatePier');
    const lintel = plan.overhead.find(v => v.tag === 'gateLintel')!;
    expect(piers.length, '門柱不是兩根').toBe(2);
    expect(lintel, '門沒有過樑').toBeTruthy();
    for (const p of piers) {
      expect(p.y1, '門柱沒有頂到過樑').toBeCloseTo(lintel.y0, 6);
      expect(Math.abs(p.x), '門柱站到過樑外面')
        .toBeLessThanOrEqual(lintel.w / 2 + 1e-9);
    }
  });
});

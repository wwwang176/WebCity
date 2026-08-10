import {
  FACADE_TRANSIT, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import { CIVIC_INSET } from '../types';
import type { InfraType } from '../../../../core/building/InfraConfig';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 三座機場 —— 小 5×4、中 7×4、大 9×6。全專案最大的單體。
 *
 * 三座**由同一個生成器產出**，只差在佔地、機位數與塔台高度。三份手寫的
 * 機場配置會有三種跑道標線的畫法、三種燈距、三種滑行道寬度 —— 而它們並排
 * 時那些不一致比任何一座畫得不好都明顯。
 *
 * 由後往前是五條帶：
 *
 * ```
 *   z-  ┌────────────────────────────────┐
 *       │  跑道（中線虛線 + 兩側邊燈 + 頭端燈） │
 *       ├────────────────────────────────┤
 *       │  滑行道（黃中線 + 中線燈 + 等待線）   │  ← 使用者特別交代的
 *       ├────────────────────────────────┤
 *       │  停機坪（機位 + 導引線 + 停著的飛機）  │
 *       ├────────────────────────────────┤
 *       │  航廈（＋塔台）                     │
 *   z+  │  前庭                             │
 *       └────────────────────────────────┘
 * ```
 *
 * 夜間語彙（spec §7）是這一批真正的內容：跑道邊燈、頭端燈、滑行道中線燈、
 * 停機坪高桿燈、塔台頂的旋轉信標。它們全部是 `PART_LAMP` 的小方塊 ——
 * 一座夜裡的機場**就是**一組排好的燈，而那正是低多邊形做得最像的東西。
 */

/** 跑道帶深（公尺）。三座相同 —— 跑道寬度不隨機場大小變。 */
const RUNWAY_D = 14;
/** 滑行道帶深（公尺）。 */
const TAXIWAY_D = 9;
/** 跑道邊燈與滑行道中線燈的間距（公尺）。 */
const LIGHT_SPACING = 10;
/** 一顆燈的邊長（公尺）。 */
const LIGHT_W = 0.5;

interface AirportSpec {
  type: InfraType;
  /** 佔地格。 */
  w: number;
  h: number;
  /** 停機位數。 */
  stands: number;
  /** 塔台高度（公尺）。 */
  towerM: number;
}

/**
 * 沿一條線排一串座標，**間距固定**、整串置中，兩端至少留 `margin`。
 *
 * 「把可用長度等分成 n 段」是錯的：那樣三座機場的跑道燈距會變成 9.25、
 * 9.94、10.35 m —— 三座並排時那個不一致比任何一座畫得不好都明顯。實際的
 * 跑道燈本來就是固定間距的，尾端剩多少就剩多少。
 */
function spread(halfSpan: number, margin: number, spacing: number): number[] {
  const usable = (halfSpan - margin) * 2;
  const n = Math.max(1, Math.floor(usable / spacing));
  const span = n * spacing;
  return Array.from({ length: n + 1 }, (_, i) => -span / 2 + spacing * i);
}

/**
 * 一座機場。
 *
 * 所有座標在函式內以**公尺**計算（機場的尺寸講公尺才有感覺），最後一次
 * `M()` 轉成格。混用兩種單位是這個檔案最容易寫錯的地方，所以規則是：
 * 區域邊界一律公尺，寫進 plan 的那一刻轉格。
 */
export function buildAirport(spec: AirportSpec): CivicPlan {
  const W = spec.w * 12;
  const H = spec.h * 12;
  const halfW = W / 2;
  const halfH = H / 2;
  /** 量體可用的半寬（公尺）。貼片不吃內縮，量體要。 */
  const limX = halfW - CIVIC_INSET * 12;

  // ── 五條帶的 z 邊界（公尺，由後往前） ──────────────────────
  const forecourtD = H * 0.07;
  const terminalD = H * 0.2;
  const apronD = H - RUNWAY_D - TAXIWAY_D - terminalD - forecourtD;
  const runwayZ0 = -halfH;
  const taxiwayZ0 = runwayZ0 + RUNWAY_D;
  const apronZ0 = taxiwayZ0 + TAXIWAY_D;
  const terminalZ0 = apronZ0 + apronD;
  const forecourtZ0 = terminalZ0 + terminalD;

  const band = (z0: number, d: number, shade: number): CivicDecal =>
    ({ x: 0, z: M(z0 + d / 2), w: M(W), d: M(d), shade });

  const decals: CivicDecal[] = [
    band(runwayZ0, RUNWAY_D, 0.12),
    band(taxiwayZ0, TAXIWAY_D, 0.16),
    band(apronZ0, apronD, 0.42),
    band(terminalZ0, terminalD, 0.5),
    band(forecourtZ0, forecourtD, 0.62),
  ];

  // ── 跑道標線 ──────────────────────────────────────────────
  const runwayCz = runwayZ0 + RUNWAY_D / 2;
  // 中線虛線。畫**虛**線而不是一條連續的白線 —— 連續的那條是滑行道的畫法，
  // 兩者用同一種線的話跑道與滑行道就分不出來了。
  for (const x of spread(halfW, 4, 9)) {
    decals.push({
      x: M(x), z: M(runwayCz), w: M(4.5), d: M(0.5),
      shade: 1.0, layer: 'mark',
    });
  }
  // 兩端的頭端橫槓（threshold）。五道並排的粗白槓 —— 那是跑道最好認的標線。
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      decals.push({
        x: M(side * (halfW - 2.5)), z: M(runwayCz + (i - 2) * 1.9),
        w: M(3.2), d: M(0.9), shade: 1.0, layer: 'mark',
      });
    }
  }

  // ── 滑行道標線 ────────────────────────────────────────────
  const taxiwayCz = taxiwayZ0 + TAXIWAY_D / 2;
  // 中線是**連續**的（跑道是虛線）。滑行道的中線在真實世界是黃色的，這裡
  // 只有灰階可用，所以用比跑道稍暗的白來區分。
  decals.push({
    x: 0, z: M(taxiwayCz), w: M(W - 2), d: M(0.5),
    shade: 0.82, layer: 'mark',
  });
  // 等待線（hold short）—— 跑道與滑行道之間那道橫線。它是滑行道語彙裡
  // 唯一「有規則意義」的標記：飛機在這裡停下來等許可。
  decals.push({
    x: 0, z: M(taxiwayZ0 + 1.2), w: M(W - 2), d: M(0.6),
    shade: 1.0, layer: 'mark',
  });
  // 從滑行道接上跑道的兩條斜引道。轉向的標線 —— 這正是 `rotationY` 存在的
  // 理由之一。
  for (const side of [-1, 1]) {
    decals.push({
      x: M(side * (halfW * 0.55)), z: M(taxiwayZ0 - 0.5),
      w: M(6.0), d: M(0.5), shade: 0.82, layer: 'mark',
      rotationY: side * Math.PI / 4,
    });
  }

  // ── 機位與導引線 ──────────────────────────────────────────
  const apronCz = apronZ0 + apronD / 2;
  const standXs = Array.from({ length: spec.stands }, (_, i) =>
    (i - (spec.stands - 1) / 2) * (W / spec.stands));
  for (const x of standXs) {
    // 進機位的導引線。
    decals.push({
      x: M(x), z: M(apronCz), w: M(0.4), d: M(apronD - 2),
      shade: 0.9, layer: 'mark',
    });
    // 停止橫槓。
    decals.push({
      x: M(x), z: M(apronCz - apronD / 2 + 2.5), w: M(4.0), d: M(0.4),
      shade: 0.9, layer: 'mark',
    });
  }

  // ── 量體 ──────────────────────────────────────────────────
  const termCz = terminalZ0 + terminalD / 2;
  const termTop = spec.h >= 6 ? 15 : 11;
  // 塔台站在航廈**旁邊**，不是裡面。第一版把塔台放在 x = −halfW + 8，而航廈
  // 從 −halfW + 5 就開始了 —— 一根 18 m 的塔穿過航廈，275 m3 的內部面。
  // 所以航廈的左緣退到 −halfW + 8，塔台佔 [−halfW + 2, −halfW + 7]。
  const towerX = -halfW + 4.5;
  const termCx = 1.5;
  const massing: CivicVolume[] = [
    {
      tag: 'terminal',
      x: M(termCx), z: M(termCz), w: M(W - 13), d: M(terminalD - 1.5),
      y0: 0, y1: M(termTop),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: M(termCx), z: M(termCz), w: M(W - 12), d: M(terminalD - 0.5),
      y0: M(termTop), y1: M(termTop + 0.6),
    },
    // 塔台。機場唯一有高度的東西 —— 遠景只剩它。
    {
      tag: 'tower',
      x: M(towerX), z: M(termCz), w: M(5.0), d: M(5.0),
      y0: 0, y1: M(spec.towerM),
    },
    {
      // 塔台的頂樓比塔身寬一圈 —— 那個外挑就是「這是塔台」而不是「一根柱子」。
      tag: 'towerCab', part: PART_ROOF,
      x: M(towerX), z: M(termCz), w: M(7.0), d: M(7.0),
      y0: M(spec.towerM), y1: M(spec.towerM + 3.2),
    },
    {
      // 旋轉信標。夜裡的機場先被看到的是它。
      tag: 'beacon', part: PART_LAMP,
      x: M(towerX), z: M(termCz), w: M(1.2), d: M(1.2),
      y0: M(spec.towerM + 3.2), y1: M(spec.towerM + 4.0),
    },
  ];

  // ── 燈 ────────────────────────────────────────────────────
  const light = (tag: string, x: number, z: number): CivicVolume => ({
    tag, part: PART_LAMP,
    x: M(x), z: M(z), w: M(LIGHT_W), d: M(LIGHT_W), y0: 0, y1: M(0.4),
  });
  // 跑道兩側的邊燈。
  for (const x of spread(limX, 2, LIGHT_SPACING)) {
    massing.push(light('runwayLight', x, runwayZ0 + 0.8));
    massing.push(light('runwayLight', x, runwayZ0 + RUNWAY_D - 0.8));
  }
  // 兩端的頭端燈，橫著排一列。
  for (const side of [-1, 1]) {
    for (const z of spread(RUNWAY_D / 2, 1.5, 3)) {
      massing.push(light('thresholdLight', side * (limX - 0.8), runwayCz + z));
    }
  }
  // 滑行道中線燈。
  for (const x of spread(limX, 3, LIGHT_SPACING)) {
    massing.push(light('taxiwayLight', x, taxiwayCz));
  }

  // ── 空橋。每個機位一條，從航廈前緣伸向飛機。 ────────────────
  const overhead: CivicVolume[] = standXs.map((x): CivicVolume => ({
    tag: 'jetBridge',
    x: M(x), z: M(terminalZ0 - 3.0), w: M(2.2), d: M(6.0),
    y0: M(4.6), y1: M(5.2),
  }));

  // ── 自訂矮物件 ────────────────────────────────────────────
  const props: CivicVolume[] = [
    // 航廈前的旅客雨庇柱。
    ...spread(W * 0.35, 0, 12).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x: M(x), z: M(forecourtZ0 - 1.0), w: M(0.3), d: M(0.3),
      y0: 0, y1: M(4.2),
    })),
    // 停機坪上的拖車與貨櫃 —— 空地上少了它們，停機坪看起來是停車場。
    ...standXs.map((x): CivicVolume => ({
      tag: 'groundUnit', part: PART_DETAIL,
      x: M(x + 6.5), z: M(apronZ0 + 2.0), w: M(2.4), d: M(1.6),
      y0: 0, y1: M(1.8),
    })),
  ];

  overhead.push({
    tag: 'terminalCanopy',
    x: 0, z: M(forecourtZ0 - 1.6), w: M(W * 0.7), d: M(3.2),
    y0: M(4.2), y1: M(4.6),
  });

  // ── 共用矮物件 ────────────────────────────────────────────
  const fixtures: PropSpec[] = [
    // 停機坪與前庭的高桿燈。
    ...spread(limX, 6, 26).map((x): PropSpec =>
      ({ kind: 'lamp', x: M(x), z: M(apronZ0 + 1.5), heightM: 8.0 })),
    ...spread(limX, 6, 26).map((x): PropSpec =>
      ({ kind: 'lamp', x: M(x), z: M(forecourtZ0 + forecourtD / 2), heightM: 5.0 })),
    // 場區圍籬。機場的界線是它最真實的一件事。
    { kind: 'fence', x: M(-limX + 0.2), z: 0, axis: 'x', length: M(H - 1) },
    { kind: 'fence', x: M(limX - 0.2), z: 0, axis: 'x', length: M(H - 1) },
    { kind: 'fence', x: 0, z: M(runwayZ0 + 0.3), axis: 'z', length: M(W - 1) },
    // 前庭的綠化與家具。
    { kind: 'tree', x: M(-limX + 3), z: M(forecourtZ0 + forecourtD / 2), heightM: 6, crownRadius: M(1.2) },
    { kind: 'tree', x: M(limX - 3), z: M(forecourtZ0 + forecourtD / 2), heightM: 6, crownRadius: M(1.2) },
    { kind: 'hedge', x: 0, z: M(forecourtZ0 + forecourtD - 0.8), axis: 'z', length: M(W * 0.4), depth: M(0.6), heightM: 1.0 },
    { kind: 'shrub', x: M(-W * 0.25), z: M(forecourtZ0 + 1.0), radius: M(0.8) },
    { kind: 'shrub', x: M(W * 0.25), z: M(forecourtZ0 + 1.0), radius: M(0.8) },
    { kind: 'flagpole', x: M(-W * 0.32), z: M(forecourtZ0 + 1.2), axis: 'z' },
    { kind: 'signPost', x: M(W * 0.32), z: M(forecourtZ0 + 1.2), axis: 'z' },
    { kind: 'bin', x: M(-4), z: M(forecourtZ0 + 0.8), radius: M(0.28) },
    { kind: 'bin', x: M(4), z: M(forecourtZ0 + 0.8), radius: M(0.28) },
    { kind: 'bollard', x: M(-8), z: M(forecourtZ0 + forecourtD - 0.4), radius: M(0.12) },
    { kind: 'bollard', x: M(8), z: M(forecourtZ0 + forecourtD - 0.4), radius: M(0.12) },
  ];

  // ── 停在機位上的飛機 ──────────────────────────────────────
  // 與天上飛的是同一份幾何。機頭朝航廈（轉 90 度）—— 不轉的話它們橫著停，
  // 而且會壓過整條導引線。
  const vehicles: CivicVehicle[] = standXs.map((x): CivicVehicle =>
    ({ kind: 'airplane', x: M(x), z: M(apronCz), rotationY: Math.PI / 2 }));
  vehicles.push(
    { kind: 'bus', x: M(-W * 0.28), z: M(forecourtZ0 + forecourtD / 2) },
    { kind: 'truck', x: M(W * 0.28), z: M(forecourtZ0 + forecourtD / 2) },
  );

  return {
    footprint: { w: spec.w, h: spec.h },
    facade: FACADE_TRANSIT,
    color: civicColorOf(spec.type),
    // 三座共用同一組 seed —— 它們是同一種建築的三個尺寸，立面節奏該一致。
    seed: [0.52, 0.34, 0.68],
    massing,
    decals,
    props,
    overhead,
    fixtures,
    vehicles,
  };
}

export const airportSmallPlan = buildAirport({
  type: 'airport_s', w: 5, h: 4, stands: 2, towerM: 18,
});
export const airportMediumPlan = buildAirport({
  type: 'airport_m', w: 7, h: 4, stands: 3, towerM: 24,
});
export const airportLargePlan = buildAirport({
  type: 'airport_l', w: 9, h: 6, stands: 5, towerM: 32,
});

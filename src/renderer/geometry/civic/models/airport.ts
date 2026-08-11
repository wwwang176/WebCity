import {
  FACADE_TRANSIT, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import { CIVIC_INSET } from '../types';
import {
  runwayCentrelines, taxiwayX, apronLaneZ, allGates,
} from '../../../airportPaths';
import type { AirportSize } from '../../../../core/transport/AirportSystem';
import type { InfraType } from '../../../../core/building/InfraConfig';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 三座機場 —— 小 5×4、中 7×4、大 9×6。全專案最大的單體。
 *
 * **整座機場的配置從 `airportPaths.ts` 推導，這個檔案不決定任何一個 z。**
 *
 * 第一版不是這樣：它照「一座機場長什麼樣」自己畫了跑道帶（在後側）、滑行道帶
 * 與停機坪，而 `AirplaneAnimator` 的航路表把跑道放在**前側**（z = +1.20）。
 * 兩份都合理，只是講的不是同一座機場 —— 接起來的那一刻，飛機會沿著航廈的
 * 屋頂降落（BUG-239）。航路表是調過、測過、而且在畫面上會動的東西，所以它是
 * 權威，貼片跟著它走。
 *
 * 由後往前三（或四）條帶，邊界全部算出來的：
 *
 * ```
 *   z-  ┌────────────────────────────────┐
 *       │  航廈（＋塔台）                    │  到 gates.z − 0.55 為止
 *       ├────────────────────────────────┤
 *       │  停機坪                          │  含 gates.z 與 apronZ
 *       │   ┊ 空橋 ┊ 空橋 ┊               │
 *       │   ●機位  ●機位  ●機位            │  ← paths.gates
 *       │  ━━━━━━━━━━━━━━━━━  橫向滑行道   │  ← paths.apronZ
 *       │  ┃                          ┃   │  ← 縱向滑行道 ±taxiwayX
 *       ├──╂──────────────────────────╂───┤
 *   z+  │  ┸  跑道（中線在 threshold.z）  ┸  │  大型機場有兩條
 *       └────────────────────────────────┘
 * ```
 *
 * 夜間語彙（spec §7）：跑道邊燈、頭端燈、滑行道中線燈、停機坪高桿燈、塔台頂的
 * 旋轉信標。一座夜裡的機場**就是**一組排好的燈。
 */

/** 跑道中線到跑道帶後緣的距離（格）。大型機場兩條中線相距 1.4 格，所以不能更寬。 */
const RUNWAY_HALF = 0.7;
/**
 * 停機位中心到航廈牆面的淨距（格）。
 *
 * 飛機停在機位上時機身**沿 z 佔 0.98 格**（11.7 m），也就是機尾伸到機位中心
 * 後方 0.49 格。原本這個值是 0.55 —— 牆與機尾之間只剩 0.06 格（0.7 m），
 * 放什麼都會卡：空橋卡到飛機、地勤車卡到空橋。
 *
 * 0.75 讓那條縫有 0.26 格（3.1 m），剛好放得下一道空橋與一台地勤車，而且
 * 兩者都在飛機的**外面**。代價是航廈帶淺了 0.2 格 —— 小型機場因此是 10.9 m
 * 深，仍然是一棟站得住的航廈。
 */
const GATE_CLEAR = 0.75;
/**
 * 航廈牆與機尾之間那條縫的深度（格）。空橋與地勤車都住在這裡。
 *
 * 它必須小於 `GATE_CLEAR − 0.49`，否則就伸進飛機裡了。
 */
const APRON_GAP = 0.24;
/** 跑道邊燈與滑行道中線燈的間距（公尺）。 */
const LIGHT_SPACING = 10;
/** 一顆燈的邊長（公尺）。 */
const LIGHT_W = 0.5;
/** 標線寬（格）。 */
const LINE_W = 0.04;
/**
 * 空橋橋面的高度（公尺）。
 *
 * 機身（`buildAirplaneGeometry`）從 −0.06 到 1.44 m —— 這個模型的飛機是壓扁
 * 的低多邊形，不是實際比例。空橋要接得到門，所以跟著**機身**走而不是跟著
 * 行人淨空走。1.0 m 落在機身高度的中段。
 */
const JET_BRIDGE_DECK = 1.0;

interface AirportSpec {
  type: InfraType;
  size: AirportSize;
  /** 佔地格。與 `InfraConfig` 一致。 */
  w: number;
  h: number;
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

/** 一條沿 x 的標線。 */
const lineX = (x: number, z: number, len: number, shade: number): CivicDecal =>
  ({ x, z, w: len, d: LINE_W, shade, layer: 'mark' });
/** 一條沿 z 的標線。 */
const lineZ = (x: number, z: number, len: number, shade: number): CivicDecal =>
  ({ x, z, w: LINE_W, d: len, shade, layer: 'mark' });

/**
 * 一座機場。
 *
 * 座標一律是**格**（與航路表同一套）。只有燈與建築的尺寸用 `M(公尺)` ——
 * 那些是「一顆燈多大」的問題，與配置無關。
 */
/** 從航路表推導出來的地面配置。全部單位是格。 */
export interface AirportLayout {
  /** 每條跑道帶的中線與前後緣。最後一條一路鋪到佔地前緣。 */
  runwayBands: Array<{ c: number; z0: number; z1: number }>;
  /** 航廈帶的前緣 = 停機坪帶的後緣。 */
  termFront: number;
  /** 停機坪帶的前緣 = 第一條跑道帶的後緣。 */
  apronBack: number;
  taxiX: number;
  laneZ: number;
  gates: readonly { x: number; z: number }[];
}

/**
 * 把航路表換算成地面上的帶。
 *
 * 抽成獨立的函式是為了讓「這張表填了離譜的值會怎樣」測得到：跑道往後挪
 * 0.8 格，停機坪就只剩 0.59 格深 —— 放不下一架 10.8 m 的飛機，而每一條
 * 「幾何與航路一致」的測試仍然是綠的（它們是相對的，表一動幾何跟著動）。
 */
export function airportLayout(size: AirportSize, h: number): AirportLayout {
  const halfH = h / 2;
  const runways = runwayCentrelines(size);
  const gates = allGates(size);
  const runwayBands = runways.map((c, i) => ({
    c,
    z0: c - RUNWAY_HALF,
    z1: i + 1 < runways.length ? runways[i + 1]! - RUNWAY_HALF : halfH,
  }));
  return {
    runwayBands,
    termFront: gates[0]!.z - GATE_CLEAR,
    apronBack: runwayBands[0]!.z0,
    taxiX: taxiwayX(size),
    laneZ: apronLaneZ(size),
    gates,
  };
}

export function buildAirport(spec: AirportSpec): CivicPlan {
  const halfW = spec.w / 2;
  const halfH = spec.h / 2;
  /** 量體可用的半寬（格）。貼片不吃內縮，量體要。 */
  const limX = halfW - CIVIC_INSET;

  // ── 全部從航路表推導 ──────────────────────────────────────
  const { runwayBands, termFront, apronBack, taxiX, laneZ, gates } =
    airportLayout(spec.size, spec.h);
  const runways = runwayBands.map(r => r.c);
  const gateZ = gates[0]!.z;

  const band = (z0: number, z1: number, shade: number): CivicDecal =>
    ({ x: 0, z: (z0 + z1) / 2, w: spec.w, d: z1 - z0, shade });

  const decals: CivicDecal[] = [
    band(-halfH, termFront, 0.5),
    band(termFront, apronBack, 0.42),
    ...runwayBands.map(r => band(r.z0, r.z1, 0.12)),
  ];

  // ── 跑道標線 ──────────────────────────────────────────────
  for (const { c } of runwayBands) {
    // 中線虛線。畫**虛**線而不是連續的白線 —— 連續的那條是滑行道的畫法。
    for (const x of spread(halfW, 0.34, 0.75)) {
      decals.push(lineX(x, c, 0.38, 1.0));
    }
    // 兩端的頭端橫槓。五道並排的粗白槓 —— 跑道最好認的標線。
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        decals.push({
          x: side * (halfW - 0.21), z: c + (i - 2) * 0.16,
          w: 0.27, d: 0.075, shade: 1.0, layer: 'mark',
        });
      }
    }
  }

  // ── 滑行道標線 —— 就是飛機真正走的那條路 ────────────────────
  const farRunway = runways[runways.length - 1]!;
  for (const side of [-1, 1]) {
    // 縱向滑行道：從橫向聯絡道一路接到最遠的那條跑道。中線是**連續**的。
    decals.push(lineZ(
      side * taxiX, (laneZ + farRunway) / 2, farRunway - laneZ, 0.82,
    ));
    // 每條跑道前的等待線。滑行道語彙裡唯一「有規則意義」的標記：
    // 飛機在這裡停下來等許可。
    for (const { c } of runwayBands) {
      decals.push({
        x: side * taxiX, z: c - RUNWAY_HALF + 0.12,
        w: 0.5, d: 0.06, shade: 1.0, layer: 'mark',
      });
    }
  }
  // 橫向聯絡道。
  decals.push(lineX(0, laneZ, taxiX * 2, 0.82));

  // ── 機位與導引線 ──────────────────────────────────────────
  for (const g of gates) {
    decals.push(lineZ(g.x, (laneZ + g.z) / 2, Math.abs(laneZ - g.z), 0.9));
    decals.push(lineX(g.x, g.z, 0.34, 0.9));
  }

  // ── 量體 ──────────────────────────────────────────────────
  const termCz = (-halfH + termFront) / 2;
  const termD = (termFront + halfH) * 0.78;
  const termTop = spec.h >= 6 ? 15 : 11;
  // 塔台站在航廈左端**之外**。塞在航廈裡的話是 275 m3 的內部面。
  const towerX = -limX + 0.4;
  const termX0 = towerX + 0.45;
  const termCx = (termX0 + (limX - 0.3)) / 2;

  const massing: CivicVolume[] = [
    {
      tag: 'terminal',
      x: termCx, z: termCz, w: (limX - 0.3) - termX0, d: termD,
      y0: 0, y1: M(termTop),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: termCx, z: termCz, w: (limX - 0.3) - termX0 + 0.06, d: termD + 0.06,
      y0: M(termTop), y1: M(termTop + 0.6),
    },
    {
      tag: 'tower',
      x: towerX, z: termCz, w: 0.42, d: 0.42, y0: 0, y1: M(spec.towerM),
    },
    {
      // 頂樓比塔身寬一圈 —— 那個外挑就是「這是塔台」而不是「一根柱子」。
      tag: 'towerCab', part: PART_ROOF,
      x: towerX, z: termCz, w: 0.58, d: 0.58,
      y0: M(spec.towerM), y1: M(spec.towerM + 3.2),
    },
    {
      // 旋轉信標。夜裡的機場先被看到的是它。
      tag: 'beacon', part: PART_LAMP,
      x: towerX, z: termCz, w: 0.1, d: 0.1,
      y0: M(spec.towerM + 3.2), y1: M(spec.towerM + 4.0),
    },
  ];

  // ── 燈 ────────────────────────────────────────────────────
  const light = (tag: string, x: number, z: number): CivicVolume => ({
    tag, part: PART_LAMP,
    x, z, w: M(LIGHT_W), d: M(LIGHT_W), y0: 0, y1: M(0.4),
  });
  for (const { c } of runwayBands) {
    // 兩側的邊燈。貼著中線兩邊 —— 排在帶的邊緣的話兩條跑道的燈會黏在一起。
    for (const x of spread(limX, 0.17, M(LIGHT_SPACING))) {
      massing.push(light('runwayLight', x, c - 0.5));
      massing.push(light('runwayLight', x, c + 0.5));
    }
    // 兩端的頭端燈，橫著排一列。
    for (const side of [-1, 1]) {
      for (const z of spread(0.45, 0.1, 0.22)) {
        massing.push(light('thresholdLight', side * (limX - 0.07), c + z));
      }
    }
  }
  // 滑行道中線燈 —— 沿著飛機真正走的路。
  for (const side of [-1, 1]) {
    for (const z of spread((farRunway - laneZ) / 2, 0.1, M(LIGHT_SPACING))) {
      massing.push(light('taxiwayLight', side * taxiX, (laneZ + farRunway) / 2 + z));
    }
  }
  for (const x of spread(taxiX, 0.2, M(LIGHT_SPACING))) {
    massing.push(light('taxiwayLight', x, laneZ));
  }

  // ── 空橋。每個機位一道，站在機位**旁邊**。 ──────────────────
  //
  // 兩件原本是錯的：
  //
  // 1. **高度**。它掛在 `overhead` 層，而那一層有「要高過 2.2 m 行人淨空」的
  //    規則 —— 於是空橋停在 4.6 m，遠遠飄在 1.44 m 高的機身上方。空橋接的是
  //    飛機不是路人，所以搬到 `props`，高度由機身頂端推導。
  // 2. **位置**。它與機位同一個 x、朝著飛機伸過去 —— 而飛機就停在那裡。
  //    使用者：「空橋應該是在飛機停靠點的旁邊」。現在它沿 x 擺在航廈牆與
  //    機尾之間那條縫裡，並往旁邊偏半個機位間距。
  const gateSpacing = gates.length > 1
    ? Math.abs(gates[1]!.x - gates[0]!.x)
    : 0.6;
  const gapZ = termFront + APRON_GAP / 2;
  const jetBridges: CivicVolume[] = gates.map((g): CivicVolume => ({
    tag: 'jetBridge',
    x: g.x + gateSpacing / 2, z: gapZ,
    w: gateSpacing * 0.55, d: APRON_GAP * 0.5,
    y0: M(JET_BRIDGE_DECK), y1: M(JET_BRIDGE_DECK + 0.35),
  }));
  const overhead: CivicVolume[] = [];

  // ── 自訂矮物件 ────────────────────────────────────────────
  const props: CivicVolume[] = [
    ...jetBridges,
    // 航廈後方（陸側）的旅客雨庇柱。
    ...spread(spec.w * 0.3, 0, 1.0).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x, z: -halfH + 0.34, w: 0.025, d: 0.025, y0: 0, y1: M(4.2),
    })),
  ];
  overhead.push({
    tag: 'terminalCanopy',
    x: 0, z: -halfH + 0.3, w: spec.w * 0.66, d: 0.28,
    y0: M(4.2), y1: M(4.6),
  });

  /**
   * 遠端機坪 —— 靜態飛機唯一能停的地方。
   *
   * `paths.gates` 上的每一個機位都是動畫飛機的目的地（而且它停 5 秒），所以
   * 那裡**一架靜態飛機都不能放**：動畫端只避開其他動畫飛機，靜態的不在它的
   * `occupiedGates` 裡，會被停在身上。
   *
   * 安全的 x 是「機位群之外、又離縱向滑行道夠遠」那兩條帶。**小型與中型
   * 算出來都是空的** —— 5 格與 7 格的停機坪被工作機位吃滿了，那就一架都不停。
   * 硬塞的下場是飛機停在滑行道上，而那比空著難看得多。遊戲裡它們不會空 ——
   * 動畫飛機會降落、滑進來、停 5 秒；只有 showcase 看得到那塊空地。
   */
  const gateRight = Math.max(...gates.map(g => g.x)) + 0.5;
  const gateLeft = Math.min(...gates.map(g => g.x)) - 0.5;
  /** 飛機轉 90 度之後沿 x 佔 10.8 m ≈ 0.9 格，取半再留一點。 */
  const PLANE_HALF = 0.5;
  /** 機身邊緣到滑行道中線要留的淨距。翼尖不能伸進滑行道。 */
  const TAXI_CLEAR = PLANE_HALF + 0.5;
  const remoteStands: number[] = [];
  for (const side of [-1, 1]) {
    const inner = side > 0 ? gateRight : gateLeft;
    const outer = side * (taxiX - TAXI_CLEAR);
    const lo = Math.min(inner, outer);
    const hi = Math.max(inner, outer);
    if (hi - lo >= PLANE_HALF * 2) remoteStands.push((lo + hi) / 2);
  }

  const vehicles: CivicVehicle[] = remoteStands.map((x): CivicVehicle =>
    ({ kind: 'airplane', x, z: gateZ, rotationY: Math.PI / 2 }));
  // 陸側（航廈後方）的接駁車與貨車。
  vehicles.push(
    { kind: 'bus', tag: 'landside', x: -spec.w * 0.22, z: -halfH + 0.62 },
    { kind: 'truck', tag: 'landside', x: spec.w * 0.22, z: -halfH + 0.62, tint: 0xcfd8dc },
  );
  // 停機坪側的**地勤車輛**。淺色是機場地勤的實際樣子，也讓它們在深色的柏油
  // 上讀得出來。使用者：「看能不能把工程車放到建築旁邊就好」——
  // 停在機位列的**兩端**，貼著航廈牆：那裡既不在任何一個機位上，也不在任何
  // 一道空橋旁邊。原本它們逐機位擺在 `g.x + 0.42`，而那個位置正好落在**下一個**
  // 機位的空橋底下。
  const rowLeft = Math.min(...gates.map(g => g.x));
  const rowRight = Math.max(...gates.map(g => g.x));
  vehicles.push(
    { kind: 'van', tag: 'groundCrew', x: rowLeft - gateSpacing * 1.25, z: gapZ, tint: 0xeceff1 },
    { kind: 'truck', tag: 'groundCrew', x: rowRight + gateSpacing * 1.25, z: gapZ, tint: 0xdce3e6 },
  );

  // ── 共用矮物件 ────────────────────────────────────────────
  const fixtures: PropSpec[] = [
    // 停機坪的高桿燈。站在橫向聯絡道與機位之間那條縫上。
    ...spread(limX, 0.5, 2.2).map((x): PropSpec =>
      ({ kind: 'lamp', x, z: (laneZ + gateZ) / 2, heightM: 8.0 })),
    // 陸側前庭的燈。
    ...spread(limX, 0.5, 2.2).map((x): PropSpec =>
      ({ kind: 'lamp', x, z: -halfH + 0.15, heightM: 5.0 })),
    // 場區圍籬。機場的界線是它最真實的一件事。
    { kind: 'fence', x: -limX + 0.02, z: 0, axis: 'x', length: spec.h - 0.08 },
    { kind: 'fence', x: limX - 0.02, z: 0, axis: 'x', length: spec.h - 0.08 },
    { kind: 'fence', x: 0, z: halfH - 0.03, axis: 'z', length: spec.w - 0.08 },
    // 陸側的綠化。全部在航廈**後方** —— 停機坪那一側是飛機在走的。
    { kind: 'tree', x: -limX + 0.25, z: -halfH + 0.25, heightM: 6, crownRadius: 0.1 },
    { kind: 'tree', x: limX - 0.25, z: -halfH + 0.25, heightM: 6, crownRadius: 0.1 },
    { kind: 'hedge', x: 0, z: -halfH + 0.07, axis: 'z', length: spec.w * 0.4, depth: 0.05, heightM: 1.0 },
    { kind: 'shrub', x: -spec.w * 0.2, z: -halfH + 0.2, radius: 0.07 },
    { kind: 'shrub', x: spec.w * 0.2, z: -halfH + 0.2, radius: 0.07 },
    { kind: 'flagpole', x: -spec.w * 0.3, z: -halfH + 0.2, axis: 'z' },
    { kind: 'signPost', x: spec.w * 0.3, z: -halfH + 0.2, axis: 'z' },
    { kind: 'bin', x: -0.35, z: -halfH + 0.18, radius: 0.024 },
    { kind: 'bin', x: 0.35, z: -halfH + 0.18, radius: 0.024 },
    { kind: 'bollard', x: -0.7, z: -halfH + 0.06, radius: 0.01 },
    { kind: 'bollard', x: 0.7, z: -halfH + 0.06, radius: 0.01 },
  ];

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
  type: 'airport_s', size: 'SMALL', w: 5, h: 4, towerM: 18,
});
export const airportMediumPlan = buildAirport({
  type: 'airport_m', size: 'MEDIUM', w: 7, h: 4, towerM: 24,
});
export const airportLargePlan = buildAirport({
  type: 'airport_l', size: 'LARGE', w: 9, h: 6, towerM: 32,
});

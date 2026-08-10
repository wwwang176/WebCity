import { FACADE_CIVIC, PART_ROOF, PART_DETAIL } from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * 高中 —— 2×3 格 = 24 × 36 m。
 *
 * 辨識特徵：三層教室樓、**橢圓跑道**、司令台。跑道是最強的那一個 ——
 * 城市裡沒有第二種建築的地上有一圈封閉的橢圓。
 *
 * ```
 *   z-  ┌──────────────────────┐
 *       │    教室樓（三層）       │
 *       └──────────┬───────────┘
 *       │  禮堂    │  司令台      │  前庭（校車停這裡）
 *       ├──────────┴───────────┤
 *       │      ╭──────────╮     │
 *       │      │  運動場   │     │  草地 + 兩圈跑道
 *   z+  │      ╰──────────╯     │
 * ```
 */

const MAIN_TOP = M(13.6);
const MAIN_ROOF = M(14.0);
const ANNEX_TOP = M(9.0);
const ANNEX_ROOF = M(9.4);
/** 司令台頂棚的下緣。柱子頂到這裡。 */
const PODIUM_EAVE = M(3.4);
const PODIUM_DECK = M(1.2);

/** 跑道的一段短直線。連起來就是橢圓。 */
export interface TrackSegment {
  x: number;
  z: number;
  /** 段長。 */
  w: number;
  /** 這一段的方向。`assembleDecals` 直接吃它。 */
  rotationY: number;
}

/**
 * 用短直線逼近一圈橢圓。
 *
 * 每一段的中心是**弦的中點**、長度是弦長、方向由弦決定 —— 所以相鄰兩段的
 * 端點會**剛好**重合（測試逐段檢查這件事）。用切線長度而不是弦長的話每一段
 * 都會多出一點，一整圈下來是二十個小交叉。
 *
 * `rotationY = atan2(−dz, dx)`：`rotateY(θ)` 把局部 +x 轉到
 * (cos θ, 0, −sin θ)，要它對齊 (dx, dz) 就得取這個角。
 */
function oval(cx: number, cz: number, a: number, b: number, n: number): TrackSegment[] {
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + a * Math.cos(t), z: cz + b * Math.sin(t) };
  });
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    return {
      x: (p.x + q.x) / 2,
      z: (p.z + q.z) / 2,
      w: Math.hypot(dx, dz),
      rotationY: Math.atan2(-dz, dx),
    };
  });
}

/** 段數。20 段的橢圓在等角視角下已經看不出是多邊形。 */
const TRACK_SEGMENTS = 20;

/**
 * 跑道。外圈與內圈兩條線 —— 一條線讀起來是「地上畫了一個橢圓」，
 * 兩條才讀得出「這中間是跑道」。
 *
 * `a` / `b` 是**外圈**的半軸，測試拿它判斷什麼東西站進圈裡了。
 */
export const TRACK = {
  x: 0,
  z: M(8.0),
  a: M(10.0),
  b: M(7.6),
  lanes: [
    oval(0, M(8.0), M(10.0), M(7.6), TRACK_SEGMENTS),
    oval(0, M(8.0), M(8.8), M(6.4), TRACK_SEGMENTS),
  ],
};

const massing: CivicVolume[] = [
  // ── 教室樓（三層）。x [−11, 11]、z [−17, −8] ────────────────
  {
    tag: 'main',
    x: 0, z: M(-12.5), w: M(22.0), d: M(9.0), y0: 0, y1: MAIN_TOP,
  },
  {
    tag: 'mainRoof', part: PART_ROOF,
    x: 0, z: M(-12.5), w: M(22.6), d: M(9.6), y0: MAIN_TOP, y1: MAIN_ROOF,
  },

  // ── 禮堂／體育館。矮而寬，與教室樓有高低差。 ────────────────
  {
    tag: 'annex',
    x: M(-6.0), z: M(-5.5), w: M(10.0), d: M(5.0), y0: 0, y1: ANNEX_TOP,
  },
  {
    // 後緣**不出簷** —— 教室樓的牆就在那條線上，伸出去就埋進牆裡。
    // （屋簷只能往沒有東西的那幾面伸，消防局的宿舍樓踩過同一個坑。）
    tag: 'annexRoof', part: PART_ROOF,
    x: M(-6.0), z: M(-5.35), w: M(10.6), d: M(5.3), y0: ANNEX_TOP, y1: ANNEX_ROOF,
  },

  // ── 司令台。站上去講話的地方 —— 與地面齊平的話它只是一塊鋪面。 ──
  {
    tag: 'podium',
    x: M(6.0), z: M(-3.2), w: M(6.0), d: M(2.4), y0: 0, y1: PODIUM_DECK,
  },

  // ── 屋頂設備 ──────────────────────────────────────────────
  ...([-7, 0, 7] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: M(-12.5), w: M(2.0), d: M(1.4), y0: MAIN_ROOF, y1: M(14.8),
  })),
];

const decals: CivicDecal[] = [
  // 前庭：z [−8, −1]。校車與教職員的車停這裡。
  { x: 0, z: M(-4.5), w: M(24.0), d: M(7.0), shade: 0.6 },
  // 運動場：z [−1, 17]
  { x: 0, z: M(8.0), w: M(24.0), d: M(18.0), shade: 0.0, lawn: true },
];

// 兩圈跑道。每一段是一條轉過向的短標線。
for (const lane of TRACK.lanes) {
  for (const s of lane) {
    decals.push({
      x: s.x, z: s.z, w: s.w, d: M(0.18),
      shade: 1.0, layer: 'mark', rotationY: s.rotationY,
    });
  }
}

/**
 * 司令台的四根柱。
 *
 * 頂棚架在柱子上而不是四面牆 —— 四面牆的話那是一間房，不是司令台。
 */
const props: CivicVolume[] = ([
  [3.4, -4.0], [8.6, -4.0], [3.4, -2.4], [8.6, -2.4],
] as const).map(([x, z]): CivicVolume => ({
  tag: 'podiumPost', part: PART_DETAIL,
  x: M(x), z: M(z), w: M(0.18), d: M(0.18), y0: PODIUM_DECK, y1: PODIUM_EAVE,
}));

const overhead: CivicVolume[] = [
  {
    tag: 'podiumRoof',
    x: M(6.0), z: M(-3.2), w: M(6.4), d: M(2.8), y0: PODIUM_EAVE, y1: M(3.7),
  },
  // 教室樓的大門雨棚。
  {
    tag: 'canopy',
    x: M(-3.0), z: M(-7.2), w: M(6.0), d: M(2.2), y0: M(3.2), y1: M(3.6),
  },
];

/**
 * 共用矮物件。**一律站在跑道圈外** —— 種在跑道上的樹跟種在消防車道上的樹
 * 是同一個笑話。安全的地帶是前庭（z < −1）與運動場的左右兩邊（|x| > 10）。
 */
const fixtures: PropSpec[] = [
  // ── 前庭的綠化 ──
  { kind: 'tree', x: M(-10.6), z: M(-2.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(10.6), z: M(-6.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(1.2), z: M(-2.2), heightM: 5.0, crownRadius: M(0.8) },
  // 運動場兩側的行道樹。x = ±11 在外圈（a = 10 m）之外。
  { kind: 'tree', x: M(-11.0), z: M(4.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(12.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(11.0), z: M(4.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(11.0), z: M(12.0), heightM: 5.6, crownRadius: M(0.7) },

  { kind: 'shrub', x: M(-1.4), z: M(-1.6), radius: M(0.6) },
  { kind: 'shrub', x: M(-3.4), z: M(-1.6), radius: M(0.6) },
  { kind: 'hedge', x: 0, z: M(16.9), axis: 'z', length: M(14.0), depth: M(0.6), heightM: 1.1 },

  { kind: 'flowerBed', x: M(-6.6), z: M(-8.6), radius: M(0.6) },
  { kind: 'flowerBed', x: M(0.6), z: M(-8.6), radius: M(0.6) },
  { kind: 'topiary', x: M(-3.0), z: M(-8.6), radius: M(0.6) },

  // ── 街道家具 ──
  { kind: 'lamp', x: M(-11.2), z: M(-3.0), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(-3.0), heightM: 4.5 },
  { kind: 'lamp', x: M(-11.2), z: M(8.0), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(8.0), heightM: 4.5 },
  { kind: 'lamp', x: M(-11.2), z: M(15.6), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(15.6), heightM: 4.5 },

  { kind: 'flagpole', x: M(10.4), z: M(-1.8), axis: 'z' },
  { kind: 'signPost', x: M(-9.0), z: M(-1.6), axis: 'z' },
  { kind: 'bin', x: M(2.6), z: M(-1.6), radius: M(0.26) },
  { kind: 'bikeRack', x: M(-8.0), z: M(-9.2), axis: 'z' },
  { kind: 'bikeRack', x: M(-8.0), z: M(-9.9), axis: 'z' },
  { kind: 'mailbox', x: M(-10.2), z: M(-9.4) },
  ...([-6.0, -2.0, 2.0, 6.0] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(-1.4), radius: M(0.11),
  })),
];

/**
 * 校車沿著路邊停 —— 與小學同一個理由：7.2 m 的車橫著停會插進校舍。
 *
 * 停在前庭右半（x > −1）：左半被禮堂佔住了。
 */
const vehicles: CivicVehicle[] = [
  { kind: 'bus', x: M(5.5), z: M(-6.5) },
  { kind: 'car', x: M(-6.0), z: M(-1.8) },
  { kind: 'van', x: M(-2.0), z: M(-1.8) },
];

/**
 * `aSeed`。
 *
 * `.x` = 0.24 給出 0.2392 格 = 2.87 m 的樓高。13.6 m 的教室樓在 3.87 m 的
 * 門廳之上還有 3.4 層的窗格 —— 讀起來是三層樓加屋突。
 */
const SEED = [0.24, 0.47, 0.58] as const;

export const highSchoolPlan: CivicPlan = {
  footprint: { w: 2, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school_high'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};

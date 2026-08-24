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
 * The three airports — small 5x4, medium 7x4, large 9x6. The largest single models in the
 * project.
 *
 * **The whole layout is derived from `airportPaths.ts`; this file decides no z of its own.**
 *
 * `AirplaneAnimator`'s path table puts the runway at the **front** (z = +1.20). Drawing the
 * runway band, taxiway band and apron here from what an airport looks like gives two
 * descriptions that are each reasonable but do not describe the same airport, and the moment
 * they meet, aircraft land along the terminal's roof (BUG-239). The path table is tuned,
 * tested and visibly in motion on screen, so it is the authority and the decals follow it.
 *
 * Three or four bands from back to front, every boundary computed:
 *
 * ```
 *   z-  ┌────────────────────────────────┐
 *       │  terminal (+ tower)             │  up to gates.z - 0.55
 *       ├────────────────────────────────┤
 *       │  apron                          │  covers gates.z and apronZ
 *       │   ┊ bridge ┊ bridge ┊           │
 *       │   ● gate   ● gate   ● gate      │  <- paths.gates
 *       │  ━━━━━━━━━━━━━━━━━ cross taxiway │  <- paths.apronZ
 *       │  ┃                          ┃   │  <- taxiways at +/-taxiwayX
 *       ├──╂──────────────────────────╂───┤
 *   z+  │  ┸  runway, centreline at threshold.z  ┸ │  two on the large airport
 *       └────────────────────────────────┘
 * ```
 *
 * Night vocabulary (spec §7): runway edge lights, threshold lights, taxiway centreline lights,
 * apron high masts, and the rotating beacon on the tower. An airport at night **is** a set of
 * arranged lights.
 */

/** Distance from a runway centreline to its band's back edge, in cells. The large airport's two centrelines are 1.4 cells apart, so it cannot be wider. */
const RUNWAY_HALF = 0.7;
/**
 * Clearance from a gate's centre to the terminal wall, in cells.
 *
 * A parked aircraft occupies **0.98 cells along z** (11.7 m), so its tail reaches 0.49 cells
 * behind the gate centre. At 0.55 the gap between wall and tail is 0.06 cells (0.7 m) and
 * nothing fits: the jet bridge fouls the aircraft, the ground vehicle fouls the jet bridge.
 *
 * 0.75 leaves that gap 0.26 cells (3.1 m), enough for one jet bridge and one ground vehicle,
 * both **outside** the aircraft. The cost is 0.2 cells off the terminal band, leaving the small
 * airport's terminal 10.9 m deep, still a building that holds up.
 */
const GATE_CLEAR = 0.75;
/**
 * Depth of the gap between the terminal wall and an aircraft's tail, in cells. Jet bridges and
 * ground vehicles both live here.
 *
 * It has to be less than `GATE_CLEAR - 0.49`, or it reaches into the aircraft.
 */
const APRON_GAP = 0.24;
/** Spacing of runway edge lights and taxiway centreline lights, in metres. */
const LIGHT_SPACING = 10;
/** Edge length of one light, in metres. */
const LIGHT_W = 0.5;
/** Marking width, in cells. */
const LINE_W = 0.04;
/**
 * Jet bridge deck height in metres.
 *
 * The fuselage (`buildAirplaneGeometry`) runs from -0.06 to 1.44 m: this model's aircraft is a
 * flattened low-poly shape, not to scale. A jet bridge has to reach a door, so it follows the
 * **fuselage** rather than pedestrian clearance. 1.0 m sits mid-way up that range.
 */
const JET_BRIDGE_DECK = 1.0;
/** Clearance between a jet bridge's tip and the nose, in cells. Larger and it does not reach; smaller and it enters the nose. */
const NOSE_CLEAR = 0.06;
/**
 * Distance from the nose to the gate centre, in cells.
 *
 * `buildAirplaneGeometry`'s fuselage is 0.72 plus an ovoid nose of 1.6 x 0.06. A parked
 * aircraft faces the terminal (-z), so its nose lies at `gate.z - PLANE_NOSE`.
 *
 * It is a constant because this file must not import the geometry, which would build a mesh at
 * load time. `Airport.test.ts` checks the value against the **actual geometry**, so a change to
 * the fuselage turns that case red.
 */
const PLANE_NOSE = 0.456;
/** Depth of the landside lane, in cells. Shuttles, the canopy and the street trees all live in this band. */
const LANDSIDE = 0.28;
/**
 * Jet bridge length, in cells.
 *
 * Twice as long and two thirds as wide as a bridge on the gate's own centreline, and set to the
 * aircraft's port side so it reads as reaching alongside the nose.
 *
 * On the gate centreline the length has to stop in front of the nose
 * (`GATE_CLEAR - nose - clearance` = 2.8 m) or it enters it. Offset to port that limit is gone:
 * it runs **past** the nose and along the fuselage, which is what a jet bridge reaching a door
 * looks like.
 *
 * 5.6 m stops 1.9 m short of the wing's leading edge, the only reasonably wide gap left on the
 * apron.
 */
const BRIDGE_LEN = (GATE_CLEAR - PLANE_NOSE - NOSE_CLEAR) * 2;
/**
 * Lateral offset of the jet bridge's centreline from the gate's, in cells.
 *
 * A parked aircraft faces -z, so **port is -x** (up x forward = (0,1,0) x (0,0,-1)). 0.16 cells
 * = 1.9 m: a 0.72 m fuselage half-width plus half the bridge width, with 0.5 m still between
 * them.
 */
const BRIDGE_SIDE = -0.16;

interface AirportSpec {
  type: InfraType;
  size: AirportSize;
  /** Footprint in cells. Matches `InfraConfig`. */
  w: number;
  h: number;
  /** Tower height in metres. */
  towerM: number;
}

/**
 * Lays out a run of coordinates along a line at **fixed spacing**, centred, keeping at least
 * `margin` at each end.
 *
 * Dividing the usable length into n equal parts is wrong: the three airports' runway light
 * spacings would come out as 9.25, 9.94 and 10.35 m, and side by side that inconsistency is
 * more visible than any one of them being drawn badly. Real runway lights are at fixed spacing,
 * and whatever is left at the ends is left.
 */
function spread(halfSpan: number, margin: number, spacing: number): number[] {
  const usable = (halfSpan - margin) * 2;
  const n = Math.max(1, Math.floor(usable / spacing));
  const span = n * spacing;
  return Array.from({ length: n + 1 }, (_, i) => -span / 2 + spacing * i);
}

/** One marking running along x. */
const lineX = (x: number, z: number, len: number, shade: number): CivicDecal =>
  ({ x, z, w: len, d: LINE_W, shade, layer: 'mark' });
/** One marking running along z. */
const lineZ = (x: number, z: number, len: number, shade: number): CivicDecal =>
  ({ x, z, w: LINE_W, d: len, shade, layer: 'mark' });

/** The ground layout derived from the path table. Every unit is cells. */
export interface AirportLayout {
  /** Each runway band's centreline and its back and front edges. The last one runs to the plot's front edge. */
  runwayBands: Array<{ c: number; z0: number; z1: number }>;
  /** The terminal band's front edge, which is the apron band's back edge. */
  termFront: number;
  /** The apron band's front edge, which is the first runway band's back edge. */
  apronBack: number;
  taxiX: number;
  laneZ: number;
  gates: readonly { x: number; z: number }[];
}

/**
 * Converts the path table into ground bands.
 *
 * A separate function so that "what if this table holds an absurd value" is testable: move the
 * runway 0.8 cells back and the apron is 0.59 cells deep, too little for a 10.8 m aircraft,
 * while every "geometry agrees with the paths" test stays green, since those are relative and
 * the geometry follows the table.
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

/**
 * One airport.
 *
 * Coordinates are always in **cells**, the same units as the path table. Only light and
 * building dimensions use `M(metres)`, since those answer "how big is one light" and have
 * nothing to do with the layout.
 */
export function buildAirport(spec: AirportSpec): CivicPlan {
  const halfW = spec.w / 2;
  const halfH = spec.h / 2;
  /** Usable half-width for masses, in cells. Decals take no inset; masses do. */
  const limX = halfW - CIVIC_INSET;

  // ── All derived from the path table ───────────────────────
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

  // ── Runway markings ───────────────────────────────────────
  for (const { c } of runwayBands) {
    // The centreline, drawn **dashed** rather than continuous: a continuous line is how
    // taxiways are marked.
    for (const x of spread(halfW, 0.34, 0.75)) {
      decals.push(lineX(x, c, 0.38, 1.0));
    }
    // Threshold bars at both ends: five thick white bars side by side, a runway's most
    // recognisable marking.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        decals.push({
          x: side * (halfW - 0.21), z: c + (i - 2) * 0.16,
          w: 0.27, d: 0.075, shade: 1.0, layer: 'mark',
        });
      }
    }
  }

  // ── Taxiway markings, along the path aircraft actually take ─
  const farRunway = runways[runways.length - 1]!;
  for (const side of [-1, 1]) {
    // The longitudinal taxiway, from the cross taxiway to the furthest runway. Its centreline
    // is **continuous**.
    decals.push(lineZ(
      side * taxiX, (laneZ + farRunway) / 2, farRunway - laneZ, 0.82,
    ));
    // The holding position before each runway: the one marking in the taxiway vocabulary that
    // carries a rule, where an aircraft stops for clearance.
    for (const { c } of runwayBands) {
      decals.push({
        x: side * taxiX, z: c - RUNWAY_HALF + 0.12,
        w: 0.5, d: 0.06, shade: 1.0, layer: 'mark',
      });
    }
  }
  // The cross taxiway.
  decals.push(lineX(0, laneZ, taxiX * 2, 0.82));

  // ── Gates and lead-in lines ───────────────────────────────
  for (const g of gates) {
    decals.push(lineZ(g.x, (laneZ + g.z) / 2, Math.abs(laneZ - g.z), 0.9));
    decals.push(lineX(g.x, g.z, 0.34, 0.9));
  }

  // ── Masses ────────────────────────────────────────────────
  // The terminal sits **against the apron band**, leaving the whole landside lane behind it.
  // Centred in its own band it leaves 1.2 m of landside, burying shuttles, trucks, canopy posts
  // and street trees inside the terminal's wall, with every existing acceptance check green.
  const termD = (termFront + halfH) - LANDSIDE;
  const termCz = termFront - termD / 2;
  const termTop = spec.h >= 6 ? 15 : 11;
  // The tower stands **outside** the terminal's left end. Inside it, that is 275 m3 of interior
  // faces.
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
      // The cab is wider than the shaft; that overhang is what makes it a control tower rather
      // than a post.
      tag: 'towerCab', part: PART_ROOF,
      x: towerX, z: termCz, w: 0.58, d: 0.58,
      y0: M(spec.towerM), y1: M(spec.towerM + 3.2),
    },
    {
      // The rotating beacon: the first thing seen of an airport at night.
      tag: 'beacon', part: PART_LAMP,
      x: towerX, z: termCz, w: 0.1, d: 0.1,
      y0: M(spec.towerM + 3.2), y1: M(spec.towerM + 4.0),
    },
  ];

  // ── Lights ────────────────────────────────────────────────
  const light = (tag: string, x: number, z: number): CivicVolume => ({
    tag, part: PART_LAMP,
    x, z, w: M(LIGHT_W), d: M(LIGHT_W), y0: 0, y1: M(0.4),
  });
  for (const { c } of runwayBands) {
    // Edge lights on both sides, hugging the centreline; at the band's edges the two runways'
    // lights would run together.
    for (const x of spread(limX, 0.17, M(LIGHT_SPACING))) {
      massing.push(light('runwayLight', x, c - 0.5));
      massing.push(light('runwayLight', x, c + 0.5));
    }
    // Threshold lights at both ends, in a row across.
    for (const side of [-1, 1]) {
      for (const z of spread(0.45, 0.1, 0.22)) {
        massing.push(light('thresholdLight', side * (limX - 0.07), c + z));
      }
    }
  }
  // Taxiway centreline lights, along the path aircraft actually take.
  for (const side of [-1, 1]) {
    for (const z of spread((farRunway - laneZ) / 2, 0.1, M(LIGHT_SPACING))) {
      massing.push(light('taxiwayLight', side * taxiX, (laneZ + farRunway) / 2 + z));
    }
  }
  for (const x of spread(taxiX, 0.2, M(LIGHT_SPACING))) {
    massing.push(light('taxiwayLight', x, laneZ));
  }

  // ── Jet bridges, reaching from the terminal wall to just short of the nose ──
  //
  // A jet bridge is **an arm** and both ends have to meet something: its root joins the
  // terminal's outer wall and its tip stops just in front of the nose.
  //
  // On the gate's own x, reaching toward the aircraft, it enters the fuselage. Laid along x in
  // the gap between wall and tail and offset half a gate sideways, it fouls nothing but touches
  // **neither** the terminal nor the aircraft, reading as a slab floating over the apron.
  //
  // The length is computed: from `termFront`, the terminal's front wall, to
  // `gateZ - nose - clearance`. Move the gates forward or lengthen the fuselage and it follows,
  // rather than being a hard-coded d.
  //
  // Height goes with it. In the `overhead` layer, whose rule is to clear 2.2 m of pedestrian
  // headroom, a jet bridge sits at 4.6 m, far above a 1.44 m fuselage. A jet bridge reaches an
  // aircraft, not a pedestrian, so it lives in `props` with its deck height following the
  // fuselage.
  const gateSpacing = gates.length > 1
    ? Math.abs(gates[1]!.x - gates[0]!.x)
    : 0.6;
  const bridgeTip = termFront + BRIDGE_LEN;
  const bridgeW = Math.min(0.16, gateSpacing * 0.4) / 1.5;
  const jetBridges: CivicVolume[] = gates.flatMap((g): CivicVolume[] => [
    {
      tag: 'jetBridge',
      x: g.x + BRIDGE_SIDE, z: (termFront + bridgeTip) / 2,
      w: bridgeW, d: BRIDGE_LEN,
      y0: M(JET_BRIDGE_DECK), y1: M(JET_BRIDGE_DECK + 0.35),
    },
    {
      // The support leg at the tip. Without it the deck is a slab floating 1 m up.
      tag: 'jetBridgeLeg', part: PART_DETAIL,
      x: g.x + BRIDGE_SIDE, z: bridgeTip - 0.03,
      w: 0.05, d: 0.05, y0: 0, y1: M(JET_BRIDGE_DECK),
    },
  ]);
  const overhead: CivicVolume[] = [];

  // ── Custom low props ──────────────────────────────────────
  const props: CivicVolume[] = [
    ...jetBridges,
    // Passenger canopy posts behind the terminal, on the landside. That band is only LANDSIDE
    // deep, so the posts hug its outer edge; at 0.34 they stand **inside** the terminal wall.
    ...spread(spec.w * 0.3, 0, 1.0).map((x): CivicVolume => ({
      tag: 'canopyPost', part: PART_DETAIL,
      x, z: -halfH + 0.26, w: 0.025, d: 0.025, y0: 0, y1: M(4.2),
    })),
  ];
  overhead.push({
    tag: 'terminalCanopy',
    x: 0, z: -halfH + 0.21, w: spec.w * 0.66, d: 0.14,
    y0: M(4.2), y1: M(4.6),
  });

  /**
   * **No static aircraft on the apron.**
   *
   * Three things rule one out:
   *
   * 1. On the gate line, an aircraft's tail covers the cross taxiway's centreline lights.
   * 2. Moved toward the terminal it hits the ground-vehicle service band: the apron is 14.8 m
   *    deep, an aircraft 11.7 m, and the remaining 3.1 m is exactly the service band's width, so
   *    fitting both misses by 0.1 m.
   * 3. It is redundant anyway. `AirplaneAnimator` lands a real aircraft, taxis it in, holds it
   *    for 5 seconds and pushes it back, in the game and in the showcase alike. A permanently
   *    motionless aircraft parked beside it only reads as broken.
   */
  const vehicles: CivicVehicle[] = [];
  // Shuttles and trucks on the landside, behind the terminal. Their z is derived from
  // `LANDSIDE`; hard-coded at 0.62 they park on the terminal's third floor.
  vehicles.push(
    { kind: 'bus', tag: 'landside', x: -spec.w * 0.26, z: -halfH + 0.15 },
    { kind: 'truck', tag: 'landside', x: spec.w * 0.26, z: -halfH + 0.15, tint: 0xcfd8dc },
  );
  // **Ground vehicles** on the apron side. Pale is what airport ground crews actually look
  // like, and it also keeps them readable against dark asphalt. They park at the **two ends** of
  // the gate row against the terminal wall, which is neither on a gate nor beside a jet bridge;
  // placed per gate at `g.x + 0.42` they land under the **next** gate's bridge.
  const rowLeft = Math.min(...gates.map(g => g.x));
  const rowRight = Math.max(...gates.map(g => g.x));
  const serviceZ = termFront + APRON_GAP / 2;
  vehicles.push(
    { kind: 'van', tag: 'groundCrew', x: rowLeft - gateSpacing * 1.25, z: serviceZ, tint: 0xeceff1 },
    { kind: 'truck', tag: 'groundCrew', x: rowRight + gateSpacing * 1.25, z: serviceZ, tint: 0xdce3e6 },
  );

  // ── Shared low props ──────────────────────────────────────
  const fixtures: PropSpec[] = [
    // Apron high masts, standing in the gap between the cross taxiway and the gates.
    ...spread(limX, 0.5, 2.2).map((x): PropSpec =>
      ({ kind: 'lamp', x, z: (laneZ + gateZ) / 2, heightM: 8.0 })),
    // Landside lane lights, at **stated** positions, one at each end, rather than through
    // `spread`: on the small airport `spread` lands exactly on +/-1.1, where the shuttle parks.
    ...([-1, 1] as const).map((s): PropSpec =>
      ({ kind: 'lamp', x: s * (limX - 0.6), z: -halfH + 0.15, heightM: 5.0 })),
    // The perimeter fence. An airport's boundary is the most literal thing about it.
    { kind: 'fence', x: -limX + 0.02, z: 0, axis: 'x', length: spec.h - 0.08 },
    { kind: 'fence', x: limX - 0.02, z: 0, axis: 'x', length: spec.h - 0.08 },
    { kind: 'fence', x: 0, z: halfH - 0.03, axis: 'z', length: spec.w - 0.08 },
    // Landside greenery, all within the landside lane; the apron side is where aircraft move.
    { kind: 'tree', x: -limX + 0.25, z: -halfH + 0.24, heightM: 6, crownRadius: 0.1 },
    { kind: 'tree', x: limX - 0.25, z: -halfH + 0.24, heightM: 6, crownRadius: 0.1 },
    { kind: 'hedge', x: 0, z: -halfH + 0.04, axis: 'z', length: spec.w * 0.4, depth: 0.03, heightM: 1.0 },
    { kind: 'flagpole', x: -spec.w * 0.4, z: -halfH + 0.2, axis: 'z' },
    { kind: 'signPost', x: spec.w * 0.4, z: -halfH + 0.2, axis: 'z' },
    { kind: 'bin', x: -0.35, z: -halfH + 0.09, radius: 0.024 },
    { kind: 'bin', x: 0.35, z: -halfH + 0.09, radius: 0.024 },
    { kind: 'bollard', x: -0.7, z: -halfH + 0.06, radius: 0.01 },
    { kind: 'bollard', x: 0.7, z: -halfH + 0.06, radius: 0.01 },
  ];

  return {
    footprint: { w: spec.w, h: spec.h },
    facade: FACADE_TRANSIT,
    color: civicColorOf(spec.type),
    // The three share one seed: they are three sizes of the same building and their facade
    // rhythm should match.
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

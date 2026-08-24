import { PART_DETAIL, PART_ROOF } from '../parts';
import { ROOF_PITCH_FRAC } from './metrics';
import type { Volume } from './volume';
import type { Dimensions } from './dimensions';
import type { Rng } from './rng';

/**
 * Massing composers: they expand a set of dimensions into a run of boxes.
 *
 * A prototype is a composer plus parameters rather than its own hand-written geometry. Two dozen
 * prototypes written by hand would be two dozen nearly identical pieces of coordinate arithmetic,
 * and any one of them getting it wrong shows up only as "one variant looks odd".
 *
 * Every composer holds three invariants, checked one by one in `MassingComposers.test.ts`:
 *   1. every mass falls within the footprint `dims` gives, which has already been confirmed not
 *      to cross the pedestrian envelope
 *   2. no two masses overlap, since an overlap creates invisible interior faces
 *   3. the highest point equals `dims.height` exactly, since height is `dimensions`' to decide
 */
export type Composer = (dims: Dimensions, rng: Rng) => Volume[];

/** A single mass. The simplest one, and the fallback for every degenerate case. */
export function single(dims: Dimensions): Volume[] {
  return [{ x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: dims.height }];
}

/**
 * A main block plus a wing. Garages, tool sheds and an industrial site's office corner all take
 * this shape.
 *
 * The wing sits toward +x and toward the front (+z): a garage only makes sense on the front yard
 * side.
 */
export function mainPlusWing(wingFrac: number, wingHeightFrac: number): Composer {
  return (dims, rng) => {
    const wingW = dims.w * wingFrac;
    const mainW = dims.w - wingW;
    const wingD = dims.d * (0.55 + 0.25 * rng());
    // The floor is **half a storey** rather than a full one: on a single-storey building, "at
    // least one storey" makes the wing level with the main block and the whole composer degenerates
    // into a box whose silhouette matches single's. A 1.6 m side structure is a store room and is
    // entirely reasonable.
    const wingH = Math.min(
      dims.height - 1e-6,
      Math.max(dims.floorHeight * 0.5, dims.height * wingHeightFrac),
    );
    return [
      { x: -dims.w / 2 + mainW / 2, z: 0, w: mainW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - wingW / 2, z: dims.d / 2 - wingD / 2,
        w: wingW, d: wingD, y0: 0, y1: wingH,
      },
    ];
  };
}

/**
 * An L-shaped plan: the long wing along the north edge, the short one along the west, meeting at
 * the north-west corner.
 *
 * The strongest asymmetric shape available: its centroid sits clearly off the bounding box's
 * centre, so four rotations really do give four faces.
 */
export function lShape(armFrac: number): Composer {
  return (dims) => {
    const armD = dims.d * armFrac;
    const armW = dims.w * armFrac;
    const restD = dims.d - armD;
    return [
      { x: 0, z: -dims.d / 2 + armD / 2, w: dims.w, d: armD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + armD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * A podium plus a tower. At `offsetFrac` 0 the tower is centred and symmetric; near 1 it is
 * pushed to the podium's edge and asymmetric, so one composer covers both faces.
 *
 * Below two storeys it falls back to a single mass: a one-storey podium leaves the tower zero
 * height.
 */
export function podiumTower(
  podiumFloors: number, towerFrac: number, offsetFrac: number,
): Composer {
  return (dims, rng) => {
    if (dims.floors < 2) return single(dims);
    const podiumH = Math.min(podiumFloors, dims.floors - 1) * dims.floorHeight;
    const tw = dims.w * towerFrac;
    const td = dims.d * towerFrac;
    const ox = ((dims.w - tw) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    const oz = ((dims.d - td) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    return [
      { x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: podiumH },
      { x: ox, z: oz, w: tw, d: td, y0: podiumH, y1: dims.height },
    ];
  };
}

/**
 * A round tower: one cylinder for the whole building, with no podium.
 *
 * `assemble`'s cylinder is 8-sided, so it is really an octagonal prism, matching the earlier
 * `makeComHighV2` of an octagonal shaft plus a disc eave.
 *
 * **Width and depth take the shorter side rather than `dims.w` and `dims.d` separately**: the two
 * are jittered independently, and using both directly gives an elliptical cylinder, while being
 * round is the whole point of the shape. Taking the shorter side also guarantees it does not
 * cross the pedestrian envelope.
 *
 * It is fully rotationally symmetric, so four rotations produce no variation at all on it, and in
 * the prototype table it has to come last and must not take an asymmetric variant's slot (see the
 * header in `prototypes.ts`).
 */
export function roundTower(diameterFrac: number): Composer {
  return (dims) => {
    const t = Math.min(dims.w, dims.d) * diameterFrac;
    const capH = dims.floorHeight * 0.12;
    return [
      { x: 0, z: 0, w: t, d: t, y0: 0, y1: dims.height - capH, shape: 'cylinder' },
      // A slightly projecting disc eave. It is a mass rather than a roof form: `roofFor` is
      // layered by variantIndex and the round tower currently falls on `flat`, which produces no
      // roof mass at all, so through the roof path it would never get an eave. This is the cap
      // from the earlier makeComHighV2.
      {
        x: 0, z: 0, w: t * 1.06, d: t * 1.06,
        y0: dims.height - capH, y1: dims.height,
        shape: 'cylinder', part: PART_ROOF,
      },
    ];
  };
}

/** Stepped setbacks. Symmetric, but with a silhouette clearly different from a single mass. */
export function setback(steps: number): Composer {
  return (dims) => {
    if (dims.floors < 2) return single(dims);
    const n = Math.max(2, Math.min(steps, dims.floors));
    const out: Volume[] = [];
    const per = dims.height / n;
    for (let i = 0; i < n; i++) {
      const frac = 1 - (i / n) * 0.4;
      out.push({
        x: 0, z: 0,
        w: dims.w * frac, d: dims.d * frac,
        y0: i * per, y1: (i + 1) * per,
      });
    }
    out[out.length - 1]!.y1 = dims.height;
    return out;
  };
}

/**
 * A U shape: two wings plus a back wall, leaving a notch in the middle.
 *
 * Its centroid is symmetric, but the notch reads as a solid 0 in a plan height map, giving it a
 * silhouette unlike any other composer's.
 */
export function notch(notchFrac: number): Composer {
  return (dims) => {
    const armW = dims.w * (1 - notchFrac) / 2;
    const backD = dims.d * 0.38;
    const restD = dims.d - backD;
    return [
      { x: 0, z: -dims.d / 2 + backD / 2, w: dims.w, d: backD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
      {
        x: dims.w / 2 - armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * Twin towers with a low link between them. The two are **deliberately unequal in height**: equal
 * towers are symmetric and rotation becomes a no-op again.
 */
export function twin(gapFrac: number): Composer {
  return (dims) => {
    if (dims.floors < 3) return single(dims);
    const towerW = dims.w * (1 - gapFrac) / 2;
    const linkH = Math.max(2, Math.floor(dims.floors * 0.3)) * dims.floorHeight;
    const linkD = dims.d * 0.6;
    return [
      { x: -dims.w / 2 + towerW / 2, z: 0, w: towerW, d: dims.d, y0: 0, y1: dims.height },
      {
        // The towers differ by 30% in height. Any less and the centroid barely shifts, and
        // rotation is a no-op again.
        x: dims.w / 2 - towerW / 2, z: 0, w: towerW, d: dims.d,
        y0: 0, y1: dims.height * 0.68,
      },
      {
        x: 0, z: 0, w: dims.w * gapFrac, d: linkD,
        y0: 0, y1: Math.min(linkH, dims.height * 0.5),
      },
    ];
  };
}

/** The minimum a stack rises above the ridge: 15% of a storey. Below that it is a bump on the roof. */
const STACK_REVEAL = 0.15;

/**
 * The shed's top surface height.
 *
 * Clamped between three limits:
 *   a floor of 0.35 storeys, below which it is no longer a shed
 *   a ceiling of `height - ridge - reveal`, because the stack has to rise visibly above the
 *          ridge. On a single-storey building a fraction of 0.62 sends the ridge to 1.07 times
 *          the height and buries the stack entirely, and single-storey variants are common in
 *          the industrial height table, whose tolerance is +/-3.1 m
 *   a target of `height * frac`
 */
function shedTop(dims: Dimensions, frac: number): number {
  const cap = dims.height - dims.floorHeight * (ROOF_PITCH_FRAC + STACK_REVEAL);
  return Math.min(
    dims.height - 1e-6,
    Math.max(dims.floorHeight * 0.35, Math.min(cap, dims.height * frac)),
  );
}

/**
 * A shed plus a ground-standing stack: chimney, silo or water tower.
 *
 * Industry's level ladder does **not** show in height — modern plants are almost all
 * single-storey with high ceilings, covering the plot, and multi-storey factories are rare (see
 * the note on `TARGET_HEIGHTS_M`). So the stack reaches the target height and the shed itself
 * takes only part of it: a 9 m stack beside a 5.6 m shed reads far more like a factory than a 9 m
 * box.
 *
 * The stack takes `PART_DETAIL` rather than `PART_WALL`: the industrial facade shader draws
 * corrugated cladding and a row of large roller doors on walls, and a chimney should have no
 * roller doors.
 */
export function shedWithStack(
  bayFrac: number, shedFrac: number, shape: 'box' | 'cylinder',
): Composer {
  return (dims, rng) => {
    const bayW = dims.w * bayFrac;
    const shedW = dims.w - bayW;
    const stackD = Math.min(bayW, dims.d * 0.5);
    return [
      { x: -dims.w / 2 + shedW / 2, z: 0, w: shedW, d: dims.d, y0: 0, y1: shedTop(dims, shedFrac) },
      {
        // The stack sits at one end of the plot rather than at the centre: centred, the whole
        // composer is symmetric again and the four rotations give nothing.
        x: dims.w / 2 - bayW / 2,
        z: (dims.d / 2 - stackD / 2) * (rng() < 0.5 ? 0.85 : -0.85),
        w: bayW, d: stackD, y0: 0, y1: dims.height,
        shape, part: PART_DETAIL,
      },
    ];
  };
}

/**
 * A shed plus a row of silos.
 *
 * This one is symmetric, deliberately: industry already has four sources of asymmetry — the wing,
 * the split span, the L, and the stack — and a fifth only repeats them, while a row of equal silos
 * is a symmetric thing by nature.
 */
export function siloRow(count: number, bayFrac: number, shedFrac: number): Composer {
  return (dims) => {
    const bayD = dims.d * bayFrac;
    const shedD = dims.d - bayD;
    const pitch = dims.w / count;
    // 0.82 rather than 1: the silos need gaps between them; touching, they are one solid wall in
    // plan.
    const dia = Math.min(bayD, pitch * 0.82);
    const out: Volume[] = [{
      x: 0, z: -dims.d / 2 + shedD / 2,
      w: dims.w, d: shedD, y0: 0, y1: shedTop(dims, shedFrac),
    }];
    for (let i = 0; i < count; i++) {
      out.push({
        x: -dims.w / 2 + pitch * (i + 0.5), z: dims.d / 2 - bayD / 2,
        w: dia, d: dia, y0: 0,
        // At least one reaches the target height and the rest fall short: a row of equal silos
        // reads as a fence.
        y1: i % 2 === 0 ? dims.height : dims.height * 0.78,
        shape: 'cylinder', part: PART_DETAIL,
      });
    }
    return out;
  };
}

/** Two spans of differing height. An industrial shed and a commercial shop-with-block behind both take this shape. */
export function splitSpan(tallFrac: number): Composer {
  return (dims) => {
    const tallW = dims.w * tallFrac;
    const lowW = dims.w - tallW;
    return [
      { x: -dims.w / 2 + tallW / 2, z: 0, w: tallW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - lowW / 2, z: 0, w: lowW, d: dims.d,
        // A floor of half a storey, for the same reason as in mainPlusWing.
        y0: 0,
        y1: Math.min(dims.height - 1e-6, Math.max(dims.floorHeight * 0.5, dims.height * 0.62)),
      },
    ];
  };
}

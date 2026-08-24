import { getInfraConfig, type InfraType } from '../core/building/InfraConfig';

/**
 * Lays every civic building out in the showcase.
 *
 * The civic mode shows all of them at once. Switching through them one at a time hides the
 * relationships **among** the nineteen: whether the colours separate, whether the height differences
 * are reasonable and whether the street furniture's density is consistent are only visible side by
 * side, and they are exactly what needs reviewing.
 *
 * Every unit here is a **cell** (1 cell = 12 m), the same system as `CivicPlan`'s coordinates.
 */

/** The open ground left between two buildings, in cells. */
export const CIVIC_LAYOUT_GAP = 2;

/**
 * A row's width limit, in cells.
 *
 * Nineteen buildings in one row run past 60 cells = 720 m, and the camera has to pull back beyond
 * any visible detail to fit them. At 18 the whole set is close to square, and a square is the
 * cheapest shape for an isometric camera.
 *
 * It has to be smaller than two large airports side by side (9 + 2 + 9 = 20), or the wrapping never
 * triggers on real data — the branch easiest to get wrong and hardest to notice.
 */
export const CIVIC_LAYOUT_ROW_LIMIT = 18;

/** One building's place in the showcase. `x` and `z` are the **footprint's centre**, aligned with the plan's origin. */
export interface CivicSlot {
  type: InfraType;
  x: number;
  z: number;
}

/**
 * Lays the types out row by row in the order given, centred on the origin.
 *
 * The order is **not** rearranged: it comes from `CIVIC_MODELS`' declaration order, which groups
 * related kinds together. Sorting by size separates the police and fire stations, and whether their
 * blue and red separate is exactly what side-by-side placement shows.
 *
 * Buildings in a row align on their **front edge**, the low-z side, rather than on their centres: an
 * aligned edge makes the number of buildings in a row readable at a glance, while centring looks
 * scattered where depths differ threefold.
 */
export function civicLayout(types: readonly InfraType[]): CivicSlot[] {
  const slots: CivicSlot[] = [];
  /** The left edge of the next building in this row. */
  let cursorX = 0;
  /** This row's front edge. */
  let rowZ = 0;
  /** The deepest building in this row so far. The next row starts beyond it. */
  let rowDepth = 0;

  for (const type of types) {
    const cfg = getInfraConfig(type);
    // An unknown type counts as 1x1 rather than throwing: the showcase exists to be looked at, and
    // a blank page over one unknown type is a bad trade.
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;

    // Wrapping is a single `if` rather than a loop, so a building wide enough to exceed the limit
    // on its own still fits — there is none today, though a large airport at 9 cells is already
    // half the limit: it wraps once and is placed where it lands. A `cursorX > 0` guard here could
    // only ever fire on the list's first building, and all it would do is push every row down by
    // one gap, invisible once centred. A branch that never fires is worse than none: it looks like
    // a guarded case.
    if (cursorX + w > CIVIC_LAYOUT_ROW_LIMIT) {
      rowZ += rowDepth + CIVIC_LAYOUT_GAP;
      cursorX = 0;
      rowDepth = 0;
    }

    slots.push({ type, x: cursorX + w / 2, z: rowZ + h / 2 });
    cursorX += w + CIVIC_LAYOUT_GAP;
    rowDepth = Math.max(rowDepth, h);
  }

  return centre(slots);
}

/**
 * How much ground the whole set occupies once laid out, in cells.
 *
 * The showcase uses it to frame the camera on all of them: nineteen buildings lay out to 18 by 30
 * cells while the default frustum is sized for an 8 by 8 block, so without adjustment the civic mode
 * opens on a small cluster in the distance.
 *
 * It measures the extent **including the footprints** rather than of the centres: on centres alone,
 * half of each outermost building falls off screen.
 */
export function civicLayoutExtent(slots: readonly CivicSlot[]): { w: number; h: number } {
  if (slots.length === 0) return { w: 0, h: 0 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of slots) {
    const cfg = getInfraConfig(s.type);
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;
    x0 = Math.min(x0, s.x - w / 2);
    x1 = Math.max(x1, s.x + w / 2);
    z0 = Math.min(z0, s.z - h / 2);
    z1 = Math.max(z1, s.z + h / 2);
  }
  return { w: x1 - x0, h: z1 - z0 };
}

/**
 * Shifts the whole set onto the origin.
 *
 * The showcase's camera points at the origin by default while the layout grows from (0, 0) into the
 * positive quadrant, so without the shift it opens on empty ground. The matrix mode hit this and
 * patches it afterwards through `setCameraTarget`; here the coordinates are laid out correctly, and
 * the camera needs to know nothing about the layout.
 */
function centre(slots: CivicSlot[]): CivicSlot[] {
  if (slots.length === 0) return slots;

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of slots) {
    const cfg = getInfraConfig(s.type);
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;
    x0 = Math.min(x0, s.x - w / 2);
    x1 = Math.max(x1, s.x + w / 2);
    z0 = Math.min(z0, s.z - h / 2);
    z1 = Math.max(z1, s.z + h / 2);
  }
  const dx = (x0 + x1) / 2;
  const dz = (z0 + z1) / 2;
  return slots.map(s => ({ ...s, x: s.x - dx, z: s.z - dz }));
}

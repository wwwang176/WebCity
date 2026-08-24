import { ZoneType } from '../../../../core/grid/types';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  shedWithStack, siloRow, roundTower,
  type Composer,
} from './composers';

/**
 * A massing prototype is a composer plus parameters plus a minimum level.
 *
 * `minLevel` is the whole mechanism behind level-to-level differences in appearance: L1 reaches
 * only the simple ones and L3 reaches everything. No separate set of shapes per level is needed.
 */
export interface Prototype {
  name: string;
  minLevel: number;
  compose: Composer;
}

const p = (name: string, minLevel: number, compose: Composer): Prototype =>
  ({ name, minLevel, compose });

/** A podium tower with the tower centred, and therefore symmetric. */
const PODIUM = podiumTower(2, 0.66, 0);
/**
 * The tower pushed to the podium's edge, and therefore asymmetric.
 *
 * At L1 the high-density zones reach only the podium tower and the slab, both symmetric, and the
 * four rotations give nothing. So this one has to be available at L1: it is that bucket's only
 * source of asymmetry.
 */
const OFFSET_TOWER = podiumTower(2, 0.6, 0.9);

/**
 * The prototypes per zone. **Asymmetric ones come first** — not a stylistic preference but
 * arithmetic:
 *
 * `prototypeFor` cycles with `variantIndex % available prototype count`, and the variant count of
 * 8 is usually not a multiple of the prototype count. The ones that wrap always land at the
 * **start** of the list, so what sits there decides the actual share of asymmetric variants. With
 * symmetric ones first, high-density residential L2 (six prototypes) reaches only 3/8, below the
 * 4/8 acceptance line.
 */
const TABLE: Record<number, Prototype[]> = {
  [ZoneType.RESIDENTIAL_LOW]: [
    p('house+garage', 1, mainPlusWing(0.4, 0.5)),
    p('gable', 1, d => single(d)),
    p('L-house', 2, lShape(0.55)),
    p('porch', 2, mainPlusWing(0.28, 0.32)),
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('L-tower', 1, lShape(0.6)),
    p('slab', 1, d => single(d)),
    p('podium', 1, PODIUM),
    p('twin', 2, twin(0.24)),
    p('setback', 2, setback(3)),
  ],
  [ZoneType.COMMERCIAL_LOW]: [
    p('shopfront', 1, splitSpan(0.55)),
    p('box', 1, d => single(d)),
    p('L-shop', 2, lShape(0.58)),
    p('shop+annex', 2, mainPlusWing(0.35, 0.6)),
    p('courtyard', 3, notch(0.34)),
  ],
  /**
   * The round tower comes last and `L-tower` sits ahead of `podium`; the two are tied together.
   *
   * With five prototypes at L3 (8 % 5 = 3, so the first three take two variants each), the
   * asymmetric offsetTower and L-tower take two each for 4/8, exactly on the acceptance line.
   * Adding the round tower makes six (8 % 6 = 2, so only the first two take two), and in the
   * original order L-tower drops to one and the asymmetric share falls to 3/8. Only placing both
   * asymmetric prototypes at the very front holds the line.
   */
  [ZoneType.COMMERCIAL_HIGH]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('L-tower', 2, lShape(0.6)),
    p('podium', 1, PODIUM),
    p('setback', 2, setback(3)),
    p('twin', 3, twin(0.22)),
    // Fully rotationally symmetric, so it goes last and takes the one variant left after the
    // remainder is distributed. A round tower is a landmark, and one in eight is enough.
    p('roundTower', 3, roundTower(0.92)),
  ],
  /**
   * Industry's level ladder does not show in height — modern plants are single-storey with high
   * ceilings, covering the plot, see `TARGET_HEIGHTS_M` — so without equipment, industry is just a
   * shorter commercial box.
   *
   * The three with equipment come first, for the same reason asymmetric ones do, but the bar here
   * is tighter: acceptance requires 4/8 variants to show a stack or a silo, and the remainder of 8
   * over the prototype count always lands at the start of the list. L3 has seven prototypes and
   * only the first takes two variants, so the three with equipment have to be the first three.
   */
  [ZoneType.INDUSTRIAL]: [
    p('stack', 1, shedWithStack(0.18, 0.62, 'cylinder')),
    p('silos', 1, siloRow(3, 0.24, 0.5)),
    p('tank', 2, shedWithStack(0.34, 0.5, 'cylinder')),
    p('shed+office', 1, mainPlusWing(0.32, 0.75)),
    p('twoSpan', 2, splitSpan(0.6)),
    p('L-shed', 3, lShape(0.6)),
    p('shed', 1, d => single(d)),
  ],
  [ZoneType.OFFICE]: [
    p('offsetTower', 1, OFFSET_TOWER),
    p('slab', 1, d => single(d)),
    p('L-tower', 2, lShape(0.6)),
    p('podium', 2, PODIUM),
    p('twin', 3, twin(0.24)),
    p('courtyard', 3, notch(0.3)),
  ],
};

const FALLBACK: Prototype = p('single', 1, d => single(d));

/** The prototypes available for this (zone, level). */
export function prototypesFor(zoneType: number, level: number): Prototype[] {
  const lv = Math.max(1, Math.min(3, level));
  return (TABLE[zoneType] ?? []).filter(x => x.minLevel <= lv);
}

/**
 * Which prototype this variant uses. It cycles in order, so every available prototype appears at
 * least once; picking at random leaves some prototypes never appearing in some buckets.
 */
export function prototypeFor(
  zoneType: number, level: number, variantIndex: number,
): Prototype {
  const ps = prototypesFor(zoneType, level);
  return ps.length === 0 ? FALLBACK : ps[variantIndex % ps.length]!;
}

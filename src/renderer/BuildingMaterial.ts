import * as THREE from 'three';
import {
  PART_THRESHOLDS, SHELL_LIFT, WATER_MURK_MAX, WATER_BOB, ZONE_CAT,
  FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN,
} from './geometry/buildings/parts';
import { FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING } from './geometry/buildings/propBands';
import { roofPaletteFor, type RoofColor } from './ColorPalettes';
import { ZoneType } from '../core/grid/types';
import { METRES_PER_CELL } from '../core/grid/constants';

/**
 * Writes a TS number in a form GLSL always reads as a float. An integer is not a float in GLSL,
 * and `vPartType > 1` is a compile error.
 */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

const vec3 = ([r, g, b]: RoofColor) =>
  `vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)})`;

/** One zone's palette chain: [0, 1) split evenly between n colours. */
function pickChain(palette: readonly RoofColor[]): string {
  const n = palette.length;
  const head = palette.slice(0, n - 1)
    .map((c, i) => `h < ${glslFloat((i + 1) / n)} ? ${vec3(c)}\n      : `)
    .join('');
  return head + vec3(palette[n - 1]!);
}

/**
 * `ZONE_CAT`'s keys sorted by ascending cat. Branch order and thresholds are both derived from it.
 */
export function sortedFacadeKeys(): number[] {
  return sortKeysByCat(ZONE_CAT);
}

/**
 * Sorts a cat table's keys by ascending cat.
 *
 * A separate function so it can be tested: `Object.entries` enumerates integer-string keys in
 * **numeric** order, and `ZONE_CAT`'s key order currently equals its cat order, so testing against
 * `ZONE_CAT` directly stays green even with `.sort()` removed entirely. Detecting whether sorting
 * happens takes a table whose key order differs from its cat order.
 */
export function sortKeysByCat(table: Record<number, number>): number[] {
  return Object.entries(table)
    .map(([k, cat]) => ({ key: Number(k), cat }))
    .sort((a, b) => a.cat - b.cat)
    .map(e => e.key);
}

/**
 * Each branch's upper bound: the midpoint between adjacent cats. The last is `Infinity`, GLSL's
 * else.
 *
 * The midpoint rather than the next cat: vertex colours are Float32, and interpolation and round
 * trips can turn 1.2 into 1.1999999. With the threshold halfway between two zones, an error has
 * to reach half a spacing before a branch is taken wrongly.
 */
export function facadeThresholds(): number[] {
  const cats = sortedFacadeKeys().map(k => ZONE_CAT[k]!);
  return cats.map((c, i) => (
    i === cats.length - 1 ? Infinity : round6((c + cats[i + 1]!) / 2)
  ));
}

/**
 * Rounds a midpoint to 6 decimal places.
 *
 * `(0.2 + 0.4) / 2` is `0.30000000000000004`, 17 significant digits, while GLSL ES 1.00's highp
 * float carries about 7 and those trailing figures are gone at compile time. Keeping them only
 * makes the generated shader harder to read and stops it matching the same number written by hand.
 *
 * Six places is far finer than the 0.2 spacing between zones, so a rounded threshold still falls
 * strictly between two cats — guarded by a test rather than by this comment.
 */
function round6(v: number): number {
  return Number(v.toFixed(6));
}

/**
 * Which key's branch this if-chain takes for a given cat value.
 *
 * It is the GLSL's JS counterpart and therefore a second copy of the data, so the tests read the
 * threshold numbers back out of the generated source and compare them against
 * `facadeThresholds()`, closing the loop.
 */
export function facadeKeyOf(cat: number): number {
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  for (let i = 0; i < keys.length; i++) if (cat < th[i]!) return keys[i]!;
  return keys[keys.length - 1]!;
}

/**
 * Generates one if-chain from `ZONE_CAT`. The roof palette and the facade share it: two
 * hand-written threshold tables are exactly the shape of "changing one reports nothing".
 *
 * This function **does not format**: whatever `bodyOf` and `commentOf` return is emitted verbatim.
 * It has to produce output character-for-character identical to the hand-written version, and
 * formatting is the opposite of that goal.
 *
 * @param varName The roof chain reads the function parameter `zoneCat`; the facade chain reads the
 *   varying `vZoneCat`.
 * @param join The roof chain separates branches with a space, the facade chain with a blank line.
 */
export function catChainGlsl(
  bodyOf: (facadeKey: number) => string,
  opts: {
    varName?: string;
    commentOf?: (facadeKey: number) => string;
    join?: string;
  } = {},
): string {
  const { varName = 'zoneCat', commentOf = () => '', join = ' ' } = opts;
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  return keys.map((key, i) => {
    const guard = Number.isFinite(th[i]!)
      ? `${i === 0 ? 'if' : 'else if'} (${varName} < ${glslFloat(th[i]!)}) `
      : 'else ';
    return `${commentOf(key)}${guard}{${bodyOf(key)}}`;
  }).join(join);
}

/**
 * `getRoofColor`'s body, generated from `ROOF_PALETTE_TABLE`.
 *
 * Zone thresholds are the midpoints between adjacent `ZONE_CAT` values. Written by hand, the
 * thresholds and the zone constants are two copies of the data, and changing one quietly gives a
 * zone somebody else's roof with nothing reported. Array indexing in WebGL1's GLSL ES 1.00
 * requires constant indices, so this still expands into an if-chain.
 */
function roofColorGlsl(): string {
  return catChainGlsl(zone => `\n    c = ${pickChain(roofPaletteFor(zone))};\n  `);
}

/**
 * Each zone's facade rules: the GLSL between `{` and `}`.
 *
 * Written directly into `BUILDING_FRAG` with six hand-written thresholds, these branches are a
 * second copy of `ZONE_CAT`. Extracted and joined by `catChainGlsl`, adding a facade category
 * takes one row in `ZONE_CAT` and one in each of these two tables, rather than also remembering
 * to edit an if-chain buried in the middle of 340 lines of GLSL.
 */
const FACADE_BODY: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: /* glsl */ `
      color = vBldgColor * 0.9;
      if (onWall) {
        // Horizontal siding, keeping the original texture.
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        vec3 wallColor = vBldgColor * (0.88 - line * 0.06);

        // A house's windows are larger and sparser than a flat's: one row per storey.
        float houseFloor = floorHeight * 0.72;
        float houseWin = windowWidth * 1.35;
        float fy = y / houseFloor;
        float fx = (wallU + phase) / houseWin;
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float winMask =
            smoothstep(0.30 - fwX, 0.30 + fwX, fracX) * smoothstep(0.70 + fwX, 0.70 - fwX, fracX)
          * smoothstep(0.30 - fwY, 0.30 + fwY, fracY) * smoothstep(0.72 + fwY, 0.72 - fwY, fracY);

        // One door on the ground floor. Its position has to be bound to the **building** rather
        // than to an in-cell offset: measuring the distance to a wall's centre with fract holds
        // for every cell, so with walls 1.5 to 2.3 cells wide on four sides, one house grows six
        // to eight doors (BUG-233).
        //
        // The only quantities constant per building inside the fragment shader are the cell
        // coordinate and the wall normal, so the cell picks one wall and the cell centre aligns
        // to that wall's middle.
        vec2 bldgCell = floor(vWorldPos.xz + 0.5);
        float wallCentre = (abs(n.x) > abs(n.z)) ? bldgCell.y : bldgCell.x;
        float doorSide = floor(hash21(bldgCell * 3.1 + 7.0) * 4.0);
        float thisSide = (abs(n.x) > abs(n.z))
          ? (n.x > 0.0 ? 0.0 : 1.0)
          : (n.z > 0.0 ? 2.0 : 3.0);
        bool doorRow = y < houseFloor;
        // The half-width is still 0.18 cells, measured in world coordinates rather than through
        // fract; the actual width is unchanged at 0.93 to 1.4 m.
        bool onDoorWall = abs(doorSide - thisSide) < 0.5;
        float doorMask = (doorRow && onDoorWall
          && abs(wallU - wallCentre) < houseWin * 0.18
          && y < houseFloor * 0.78) ? 1.0 : 0.0;
        // The rest of the ground floor still gets windows. At winMask = 0 the whole ground floor
        // has none and therefore no windowMask: no glass, no sky reflection, and never lit at
        // night.
        winMask *= 1.0 - doorMask;

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 4.7;
        float period = 150.0 + hash21(wid + 99.0) * 150.0;
        float phaseT = hash21(wid * 2.71 + 47.0) * period;
        float epoch = floor((uTime + phaseT) / period);
        float lit = hash21(wid + epoch * 13.7);
        float litThresh = mix(0.95, 0.45, occ);

        vec3 winColor;
        if (lit > litThresh) {
          float w = hash21(wid + 77.7);
          winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = winMask > 0.5;
        } else {
          winColor = vBldgColor * 0.24 + vec3(0.03, 0.05, 0.08);
        }

        vec3 doorColor = vBldgColor * 0.35 + vec3(0.06, 0.03, 0.02);
        color = mix(wallColor, winColor, winMask);
        color = mix(color, doorColor, doorMask);
        windowMask = winMask;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,
  [ZoneType.RESIDENTIAL_HIGH]: /* glsl */ `
      float fy = y / floorHeight;
      float fx = (wallU + phase) / windowWidth;
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.2 - fwX, 0.2 + fwX, fracX) * smoothstep(0.8 + fwX, 0.8 - fwX, fracX)
        * smoothstep(0.25 - fwY, 0.25 + fwY, fracY) * smoothstep(0.68 + fwY, 0.68 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.88;
      if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.72;
      }
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshRH = mix(0.95, 0.4, occ);
      if (lit > litThreshRH) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.22 + vec3(0.03, 0.05, 0.08);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.COMMERCIAL_LOW]: /* glsl */ `
      if (onWall && y < ${glslFloat(SHOPFRONT_CEILING)}) {
        // Shopfront glazing: a full storey of glass with vertical mullions only and **no
        // horizontal floor line**, which is exactly why it looks different from the small windows
        // above and has to stay that way.
        //
        // The top edge takes SHOPFRONT_CEILING rather than a local 0.22: the canopy hangs on that
        // same line, and written on both sides the canopy lands across the middle of the
        // glazing.
        float bay = wallU / 0.25;
        float bayU = fract(bay);
        float fwB = fwidth(bay);
        float glass = smoothstep(0.06 - fwB, 0.06 + fwB, bayU)
                    * smoothstep(0.94 + fwB, 0.94 - fwB, bayU);
        vec2 wid = floor(vec2(bay, 0.0)) + floor(vWorldPos.xz + 0.5) * 3.7;
        float r = hash21(wid);
        vec3 glassColor = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        color = mix(vBldgColor * 0.6, glassColor, glass); // 窗框 -> 玻璃

        // Whether this bay's shop is open tonight. Per bay rather than per building: a row of
        // shopfronts all dark or all lit is wrong either way.
        float sPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float sPhase = hash21(wid * 2.71 + 47.0) * sPeriod;
        float sEpoch = floor((uTime + sPhase) / sPeriod);
        float sLit = hash21(wid + sEpoch * 13.7);
        // Shopfronts are lit more often than the offices above: they are what a shopping street
        // looks like at night.
        float litThreshSF = mix(0.95, 0.25, occ);
        if (sLit > litThreshSF) {
          winBrightness = 0.7 + hash21(wid + 21.3) * 0.5;
          isLitWindow = glass > 0.5;
        }
        windowMask = glass;
        // By day the glazing already has its own glass colour and per-bay variation. Replacing it
        // wholesale with one sky reflection erases that, so only part is taken.
        glassiness = 0.45;
      } else if (onWall) {
        // Upper wall — sparse small windows
        float fy = y / (floorHeight * 1.2);
        float fx = (wallU + phase) / (windowWidth * 1.1);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fracX);
        float fwY = fwidth(fracY);
        float winMask = smoothstep(0.3 - fwX, 0.3 + fwX, fracX) * smoothstep(0.7 + fwX, 0.7 - fwX, fracX)
                      * smoothstep(0.3 - fwY, 0.3 + fwY, fracY) * smoothstep(0.65 + fwY, 0.65 - fwY, fracY);
        vec3 wallColor = vBldgColor * 0.85;
        vec3 winColor;
        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 5.3;
        float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
        float litThreshCL = mix(0.95, 0.5, occ);
        if (lit > litThreshCL) {
          winColor = mix(vec3(0.9, 0.85, 0.6), vec3(0.8, 0.7, 0.45), lit) * 0.8;
          winBrightness = brightness;
          isLitWindow = winMask > 0.5;
        } else {
          winColor = vBldgColor * 0.25 + vec3(0.03, 0.04, 0.08);
        }
        color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      } else {
        color = vBldgColor * 0.85;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.COMMERCIAL_HIGH]: /* glsl */ `
      float fy = y / (floorHeight * 0.88);
      float fx = (wallU + phase) / (windowWidth * 0.5);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.08 - fwX, 0.08 + fwX, fracX) * smoothstep(0.92 + fwX, 0.92 - fwX, fracX)
        * smoothstep(0.12 - fwY, 0.12 + fwY, fracY) * smoothstep(0.82 + fwY, 0.82 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.5; // narrow mullions
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshCH = mix(0.95, 0.3, occ);
      if (lit > litThreshCH) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.92, 0.88, 0.65), vec3(0.82, 0.72, 0.42), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vec3(0.35, 0.48, 0.58) * (0.6 + hash21(wid + 33.3) * 0.3);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.INDUSTRIAL]: /* glsl */ `
      if (onWall) {
        // Horizontal corrugation ridges
        float ridge = fract(y / 0.08);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.72 + shade * 0.18);

        // The high window band. A plant's windows sit high, because the wall below carries racking
        // and machinery, so they are not a grid of small panes but a strip beneath the floor line.
        // It is positioned from the existing floor rhythm, so a single-storey shed and a
        // three-storey one both line up.
        float fy = y / floorHeight;
        float fx = (wallU + phase) / (windowWidth * 2.2);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float bandMask =
            smoothstep(0.62 - fwY, 0.62 + fwY, fracY) * smoothstep(0.86 + fwY, 0.86 - fwY, fracY)
          * smoothstep(0.12 - fwX, 0.12 + fwX, fracX) * smoothstep(0.88 + fwX, 0.88 - fwX, fracX);

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 6.7;
        float wPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float wPhase = hash21(wid * 2.71 + 47.0) * wPeriod;
        float wEpoch = floor((uTime + wPhase) / wPeriod);
        float wLit = hash21(wid + wEpoch * 13.7);
        // Fewer of a plant's windows are lit at night than a house's: only the bays on night
        // shift.
        float litThreshIN = mix(0.98, 0.6, occ);
        vec3 winColor;
        if (wLit > litThreshIN) {
          // Cool white: a plant uses metal halide or LED, not a home's warm light.
          winColor = mix(vec3(0.90, 0.92, 0.80), vec3(0.78, 0.84, 0.72), wLit) * 0.85;
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = bandMask > 0.5;
        } else {
          winColor = vBldgColor * 0.22 + vec3(0.04, 0.05, 0.07);
        }
        color = mix(color, winColor, bandMask);
        windowMask = bandMask;

        // Large loading door at ground level
        // **Drawn after the high windows**, so it covers any that fall in the same height range:
        // on a low-storey plant the band lands within the door's height, and the two overlapping
        // give a roller door with windows in it.
        float doorU = fract(wallU / 0.35);
        if (y < 0.18 && doorU > 0.12 && doorU < 0.88) {
          color = vBldgColor * 0.4 + vec3(0.02, 0.02, 0.01);
          // Horizontal door slats
          float slat = fract(y / 0.03);
          color *= 0.9 + 0.1 * step(0.5, slat);

          // Some roller doors are open, with the light inside spilling out across them.
          // glassiness = 0: a roller door passes light but is not glass — by day it should
          // neither turn blue nor take a sun highlight.
          vec2 did = vec2(floor(wallU / 0.35), 0.0) + floor(vWorldPos.xz + 0.5) * 9.1;
          float dPeriod = 200.0 + hash21(did + 5.0) * 200.0;
          float dPhase = hash21(did * 1.7 + 13.0) * dPeriod;
          float dEpoch = floor((uTime + dPhase) / dPeriod);
          float dOpen = hash21(did + dEpoch * 3.3);
          windowMask = 1.0;
          glassiness = 0.0;
          isLitWindow = dOpen > mix(0.99, 0.68, occ);
          winBrightness = 0.8 + hash21(did + 4.4) * 0.4;
        }
      } else {
        color = vBldgColor * 0.78;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,
  [ZoneType.OFFICE]: /* glsl */ `
      float fy = y / floorHeight;
      float fx = (wallU + phase) / (windowWidth * 0.625);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.15 - fwX, 0.15 + fwX, fracX) * smoothstep(0.85 + fwX, 0.85 - fwX, fracX)
        * smoothstep(0.2 - fwY, 0.2 + fwY, fracY) * smoothstep(0.72 + fwY, 0.72 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.88;
      if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.7;
      }
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshOF = mix(0.95, 0.35, occ);
      if (lit > litThreshOF) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.2 + vec3(0.03, 0.05, 0.09);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,

  [FACADE_CIVIC]: /* glsl */ `
      // Civic buildings: concrete or masonry, with windows larger than a house's and sparser than
      // an office's, and a solid string course between floors. The ground floor is a double-height
      // lobby, so the window grid starts above it; measured from the ground, a police station's
      // ground floor grows the same small windows as its third, which is exactly why it stops
      // looking like a civic building.
      float portico = floorHeight * 1.35;
      float fy = (y - portico) / floorHeight;
      float fx = (wallU + phase) / (windowWidth * 1.15);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = (onWall && y > portico)
        ? smoothstep(0.22 - fwX, 0.22 + fwX, fracX) * smoothstep(0.78 + fwX, 0.78 - fwX, fracX)
        * smoothstep(0.20 - fwY, 0.20 + fwY, fracY) * smoothstep(0.74 + fwY, 0.74 - fwY, fracY)
        : 0.0;

      vec3 wallColor = vBldgColor * 0.93;
      // The string course: a solid band at the floor line. Almost every civic facade has one.
      if (onWall && y > portico && (fracY > 0.86 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.76;
      }

      // Powered, about 85% of the windows are lit, and which ones changes over time as shifts
      // change and people leave. A whole building lit reads as a glowing slab rather than a
      // building.
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 6.1;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phaseT = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phaseT) / period);
      bool lit = powered && hash21(wid + epoch * 13.7) > civicDark;
      vec3 winColor;
      if (lit) {
        float w = hash21(wid + 77.7);
        // Cool white: a civic building uses fluorescent light, not a home's warm light.
        winColor = mix(vec3(0.92, 0.94, 0.88), vec3(0.82, 0.86, 0.80), w) * (0.82 + w * 0.14);
        winBrightness = 0.78 + hash21(wid + 21.3) * 0.22;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.24 + vec3(0.03, 0.05, 0.08);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;

      // The lobby: a full storey of glazing divided between columns, with **no horizontal floor
      // line**. Drawn after the window grid, so it covers anything in the same height range.
      if (onWall && y <= portico && y > 0.06) {
        float bay = wallU / 0.34;
        float bayU = fract(bay);
        float fwB = fwidth(bay);
        float glass = smoothstep(0.16 - fwB, 0.16 + fwB, bayU)
                    * smoothstep(0.84 + fwB, 0.84 - fwB, bayU);
        vec2 lid = vec2(floor(bay), 0.0) + floor(vWorldPos.xz + 0.5) * 4.3;
        vec3 glassColor = mix(vec3(0.42, 0.52, 0.60), vec3(0.52, 0.62, 0.68), hash21(lid));
        color = mix(vBldgColor * 0.66, glassColor, glass);   // 石材柱 -> 玻璃
        windowMask = glass;
        // The lobby stays lit all night, since the duty desk is there. It is what a civic building
        // looks like at night.
        isLitWindow = powered && glass > 0.5;
        winBrightness = 0.75 + hash21(lid + 4.1) * 0.3;
        // By day the lobby glazing already has its own colour and per-bay variation, and replacing
        // it wholesale with one sky reflection erases that, so only part is taken — the same
        // reason as low-density commercial's shopfronts.
        glassiness = 0.5;
      }

      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.62 + 0.38 * ao;
    `,

  [FACADE_UTILITY]: /* glsl */ `
      // Utilities: power plant, water plant, landfill, sewage plant. They are industrial
      // facilities that happen to be municipal, so they borrow industry's corrugated cladding and
      // high window band — but no roller doors, which belong to a freight shed, replaced by a band
      // of permanently lit warning lamps.
      if (onWall) {
        float ridge = fract(y / 0.09);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.70 + shade * 0.20);

        // The high window band: machinery and pipework fill the lower wall, so the windows sit in
        // a strip beneath the floor line.
        float fy = y / floorHeight;
        float fx = (wallU + phase) / (windowWidth * 2.4);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float bandMask =
            smoothstep(0.64 - fwY, 0.64 + fwY, fracY) * smoothstep(0.88 + fwY, 0.88 - fwY, fracY)
          * smoothstep(0.10 - fwX, 0.10 + fwX, fracX) * smoothstep(0.90 + fwX, 0.90 - fwX, fracX);

        // These run around the clock and are therefore lit more than an ordinary plant, though a
        // few bays stay dark — under maintenance, or an unused unit — and which ones changes over
        // time.
        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 8.3;
        float wPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float wPhase = hash21(wid * 2.71 + 47.0) * wPeriod;
        float wEpoch = floor((uTime + wPhase) / wPeriod);
        // Round-the-clock operation with few windows to begin with: a little brighter than a civic
        // building.
        bool wOn = powered && hash21(wid + wEpoch * 13.7) > civicDark * 0.8;
        vec3 winColor;
        if (wOn) {
          float w = hash21(wid + 77.7);
          // Metal halide's cool white.
          winColor = mix(vec3(0.90, 0.93, 0.84), vec3(0.76, 0.83, 0.74), w) * 0.88;
          winBrightness = 0.72 + hash21(wid + 21.3) * 0.28;
          isLitWindow = bandMask > 0.5;
        } else {
          winColor = vBldgColor * 0.22 + vec3(0.04, 0.05, 0.07);
        }
        color = mix(color, winColor, bandMask);
        windowMask = bandMask;

        // The warning lamp band: a high row of permanently lit red points. **Drawn after the high
        // windows**, so it covers any in the same height range; overlapping, the two give a window
        // with red dots in it.
        float lampU = fract(wallU / 0.55);
        float lampBand = smoothstep(0.40 - fwidth(y), 0.40 + fwidth(y), fracY)
                       * smoothstep(0.46 + fwidth(y), 0.46 - fwidth(y), fracY);
        float lampDot = lampBand * step(0.42, lampU) * step(lampU, 0.58);
        if (lampDot > 0.5) {
          color = vec3(0.35, 0.10, 0.08);
          windowMask = 1.0;
          // A warning lamp is not glass: by day it should neither turn blue nor take a sun
          // highlight.
          glassiness = 0.0;
          // Warning lamps run on emergency power and stay lit through an outage, so they do not
          // read powered.
          isLitWindow = true;
          winBrightness = 0.9;
        }
      } else {
        color = vBldgColor * 0.76;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,

  [FACADE_TRANSIT]: /* glsl */ `
      // Transit stops: glazing and light construction. Platforms and concourses stay lit all
      // night — a station is among the brightest things in a city at night, far brighter than an
      // office block.
      float fy = y / (floorHeight * 1.1);
      float fx = (wallU + phase) / (windowWidth * 0.75);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      // The mullions are thin: a station's glazing comes in large panes.
      float winMask = onWall
        ? smoothstep(0.06 - fwX, 0.06 + fwX, fracX) * smoothstep(0.94 + fwX, 0.94 - fwX, fracX)
        * smoothstep(0.08 - fwY, 0.08 + fwY, fracY) * smoothstep(0.90 + fwY, 0.90 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.55;   // 細窗櫺

      // A station is among the brightest things in a city at night, so its dark fraction is half
      // everyone else's — but not zero: the platform's far end and the closed gatelines are
      // dark.
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 5.9;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phaseT = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phaseT) / period);
      // Among the brightest things in a city at night, with half everyone else's dark fraction.
      bool lit = powered && hash21(wid + epoch * 13.7) > civicDark * 0.5;
      vec3 winColor;
      if (lit) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.94, 0.95, 0.90), vec3(0.86, 0.90, 0.86), w) * (0.86 + w * 0.12);
        winBrightness = 0.85 + hash21(wid + 21.3) * 0.25;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vec3(0.38, 0.50, 0.60) * (0.6 + hash21(wid + 33.3) * 0.3);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,

  [FACADE_GREEN]: /* glsl */ `
      // Green space: parks and cemeteries. There is almost no wall here — what reaches this
      // branch is boundary walls, retaining walls, the gaps between a pavilion's posts, and the
      // keeper's hut.
      //
      // **No window grid, deliberately.** One tag cannot separate a keeper's hut from a boundary
      // wall, and windows on a boundary wall look far worse than a hut without them. A park's
      // presence at night comes from PART_LAMP garden lamps rather than windows, which is how a
      // real park looks after dark: the lamps are lit and the buildings are not.
      if (onWall) {
        // Masonry: horizontal courses plus world-coordinate noise, so a whole boundary wall is not
        // one flat colour.
        float course = fract(y / 0.055);
        float joint = smoothstep(0.0, 0.05, course) * smoothstep(0.10, 0.05, course);
        float grain = hash21(floor(vWorldPos.xz * 18.0)) * 0.06 - 0.03;
        color = (vBldgColor * (0.86 - joint * 0.10) + grain);
      } else {
        color = vBldgColor * 0.82;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.68 + 0.32 * ao;
    `,
};

/** The comment placed before each branch's `if`. Kept apart from `FACADE_BODY` so the bodies stay pure GLSL. */
const FACADE_COMMENT: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: '    // ---- RESIDENTIAL LOW: painted siding, no window grid ----\n    ',
  [ZoneType.RESIDENTIAL_HIGH]: '    // ---- RESIDENTIAL HIGH: medium-spaced windows ----\n    ',
  [ZoneType.COMMERCIAL_LOW]: '    // ---- COMMERCIAL LOW: storefront glass bottom, simple wall above ----\n    ',
  [ZoneType.COMMERCIAL_HIGH]: '    // ---- COMMERCIAL HIGH: dense glass curtain wall ----\n    ',
  [ZoneType.INDUSTRIAL]: '    // ---- INDUSTRIAL: corrugated metal, large doors ----\n    ',
  [ZoneType.OFFICE]: '    // ---- OFFICE: dense window grid ----\n    ',
  [FACADE_CIVIC]: '    // ---- CIVIC: masonry, banded floors, tall lit lobby ----\n    ',
  [FACADE_UTILITY]: '    // ---- UTILITY: corrugated metal, clerestory band, hazard lights ----\n    ',
  [FACADE_TRANSIT]: '    // ---- TRANSIT: light glass envelope, lit all night ----\n    ',
  [FACADE_GREEN]: '    // ---- GREEN: masonry walls only, no window grid ----\n    ',
};

/** The facade if-chain. It reads the varying `vZoneCat` and separates branches with a blank line. */
function facadeChainGlsl(): string {
  return catChainGlsl(facadeBodyOf, {
    varName: 'vZoneCat',
    commentOf: key => FACADE_COMMENT[key] ?? '    ',
    join: '\n\n',
  });
}

/**
 * This facade category's GLSL. A missing table **throws on the spot**.
 *
 * Without the throw, adding a category to `ZONE_CAT` and forgetting its facade gives that class of
 * building a flat windowless wall, which reads as unfinished rather than broken and survives until
 * someone posts a screenshot asking about it. Eliminating that kind of silence is the whole reason
 * the if-chain exists, so it cannot carry a silent default of its own.
 */
function facadeBodyOf(key: number): string {
  const body = FACADE_BODY[key];
  if (body === undefined) {
    throw new Error(
      `立面類別 ${key} 在 ZONE_CAT 裡有 cat ${ZONE_CAT[key]} 卻沒有 FACADE_BODY`,
    );
  }
  return body;
}

// ===== Building Shader =====
export const BUILDING_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

// The vertex stage needs time too: the water level's motion is real displacement, not a fragment
// pattern.
uniform float uTime;

attribute float aHighlight;
attribute vec3 aHighlightColor;
attribute float aOccupancy;
attribute vec3 aSeed;
// Per-geometry building colour.
//
// Instanced buildings use instanceColor (InstancedMesh.setColorAt). Civic buildings are plain
// Meshes under a Group in the game and plain Meshes in the showcase, and neither has
// instanceColor, so this attribute is what gives them a colour of their own. Hard-coded to
// vec3(0.7), that path leaves police station and fire station walls the same grey.
//
// Note: no backticks here — the whole GLSL block lives inside a template literal.
attribute vec3 aBldgColor;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;
varying float vGroundShade;
varying float vHighlight;
varying vec3 vHighlightColor;
varying float vOccupancy;
varying vec3 vSeed;

void main() {
  vLocalPos = position;
  vHighlight = aHighlight;
  vHighlightColor = aHighlightColor;
  vOccupancy = aOccupancy;
  vSeed = aSeed;

  #ifdef USE_COLOR
    vPartType = color.r;
    vZoneCat = color.g;
    vGroundShade = color.b;
  #else
    vPartType = 0.0;
    vZoneCat = 0.0;
    vGroundShade = 0.0;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vBldgColor = instanceColor;
  #else
    vBldgColor = aBldgColor;
  #endif

  #ifdef USE_INSTANCING
    mat4 world = modelMatrix * instanceMatrix;
  #else
    mat4 world = modelMatrix;
  #endif

  vec4 wPos = world * vec4(position, 1.0);

  // The water level rises and falls. **Only upward-facing surfaces move**: moving the walls too
  // makes the whole vessel breathe.
  //
  // The fragment stage's shimmer is only colour and the plane itself does not move, which is a
  // visible difference, so the real displacement happens here. The phase takes world coordinates,
  // so two adjacent basins do not move in step.
  if (vPartType > ${glslFloat(PART_THRESHOLDS.WATER_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.WATER_MAX)}
    && normal.y > 0.5) {
    wPos.y += sin(uTime * ${glslFloat(WATER_BOB.SPEED)}
      + wPos.x * 5.0 + wPos.z * 3.3) * ${glslFloat(WATER_BOB.AMP_M / METRES_PER_CELL)};
  }

  vWorldPos = wPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = projectionMatrix * viewMatrix * wPos;

  // Shadow map: transformedNormal required by shadowmap_vertex
  vec3 transformedNormal = vNormal;
  vec4 worldPosition = wPos;
  #include <shadowmap_vertex>
}
`;

export const BUILDING_FRAG = /* glsl */ `
precision highp float;

#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>

uniform float uGlobalOpacity;
uniform float uDesaturate;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;
varying float vGroundShade;
varying float vHighlight;
varying vec3 vHighlightColor;
varying float vOccupancy;
varying vec3 vSeed;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// === Independent roof color palettes per zone ===
// The body is generated from ColorPalettes.ROOF_PALETTE_TABLE: the colours are testable only
// where they live.
vec3 getRoofColor(float zoneCat, float h) {
  vec3 c = vec3(0.35, 0.35, 0.38);
  ${roofColorGlsl()}
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  bool isLitWindow = false;
  float windowMask = 0.0;
  float winBrightness = 1.0;

  // Read real lights from Three.js uniforms (set by lights_pars_begin)
  #if NUM_DIR_LIGHTS > 0
    // directionalLights[].direction is view-space; convert to world-space
    vec3 sd = directionalLights[0].direction;
    mat3 vm = mat3(viewMatrix);
    vec3 sunDir = normalize(vec3(dot(vm[0], sd), dot(vm[1], sd), dot(vm[2], sd)));
    vec3 sunColor = directionalLights[0].color;
    float sunIntensity = length(sunColor);
  #else
    vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
    vec3 sunColor = vec3(1.0);
    float sunIntensity = 1.0;
  #endif
  float sunDiff = max(dot(n, sunDir), 0.0);
  vec3 fillDir = normalize(vec3(-0.6, 0.3, -0.4));
  float fillDiff = max(dot(n, fillDir), 0.0);
  vec3 indirect = max(vec3(0.08), ambientLightColor * 0.7) + 0.13 * fillDiff * sunColor;
  vec3 direct = 0.45 * sunDiff * sunColor;
  vec3 lighting = indirect + direct;
  float directRatio = length(direct) / max(length(lighting), 0.001);

  bool isFoliage = vPartType > ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)} && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MAX)};
  // Metal and dark details: water tanks, air handling units, antennas, pipe racks. No windows and
  // no zone facade rules, or rooftop equipment grows a grid of windows.
  bool isDetail = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.LAMP_MIN)};
  // Things that emit light: lamp heads, projecting signs, billboards. Separating them from
  // isDetail is necessary — water tanks and pipe racks should not light up at night, and with a
  // single tag the only alternative is that neither does.
  bool isLamp = vPartType > ${glslFloat(PART_THRESHOLDS.LAMP_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)};
  // Ground decals: asphalt, paving, markings. Their own branch, or they fall to the wall branch
  // and asphalt grows a grid of windows.
  bool isGround = vPartType > ${glslFloat(PART_THRESHOLDS.GROUND_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.GROUND_MAX)};
  // Water. Separating it from the ground branch is necessary: the ground ramp runs from asphalt to
  // brick and is entirely grey, so very dark paving is the closest this shader can draw to water —
  // and half a quay's conviction comes from the blue beside it.
  bool isWater = vPartType > ${glslFloat(PART_THRESHOLDS.WATER_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.WATER_MAX)};
  // Painted shells: water tanks, stacks, storage vessels, cooling towers. The only branch that
  // draws a mass in its own colour — walls are darkened by the facade rules and given a high
  // window band, while isDetail hard-codes a metal grey, where specifying a colour does nothing.
  bool isShell = vPartType > ${glslFloat(PART_THRESHOLDS.SHELL_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.SHELL_MAX)};
  bool isRoof = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_MIN)} || (n.y > 0.85 && vPartType < ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)});
  bool isFloor = n.y < -0.85;

  vec3 color;

  // Whether this piece is glass by day. 1 replaces it entirely with a sky reflection and takes a
  // sun highlight, as an ordinary window does; 0 reflects nothing, as an industrial roller door
  // that passes light at night but is not glass. Shopfront glazing takes a middle value: by day it
  // already has its own glass colour and per-bay variation, and one uniform reflection erases
  // that.
  float glassiness = 1.0;
  // Emissive light, added only at night and after shadowing: a sign or a lamp head is not
  // shadowed by its own building.
  vec3 emissive = vec3(0.0);

  if (isFoliage) {
    // Green foliage with variation based on position
    float fh = hash21(vWorldPos.xz * 3.7);
    vec3 baseGreen = mix(vec3(0.18, 0.35, 0.12), vec3(0.25, 0.45, 0.15), fh);
    // Darker at bottom, lighter at top
    float topFade = smoothstep(0.0, 0.25, vWorldPos.y);
    color = baseGreen * (0.7 + 0.3 * topFade);
    color *= lighting;
  } else if (isLamp) {
    // A lamp shade or sign panel: a grey-white board by day, glowing at night.
    float g = 0.62 + vSeed.z * 0.12;
    color = vec3(g, g * 0.98, g * 0.94) * lighting;
    // **An empty building should not light.** Burned and vacant buildings have occupancy 0 and
    // their signage goes dark with them. smoothstep rather than step: a half-empty block does not
    // need its whole run of signs to go out at once.
    emissive = vec3(1.0, 0.86, 0.58) * 0.95 * smoothstep(0.0, 0.15, vOccupancy);
  } else if (isDetail) {
    // A slightly blue mid-grey metal, with brightness varied by the seed so a field of equipment
    // is not one colour.
    float m = 0.42 + vSeed.z * 0.16;
    color = vec3(m, m * 1.02, m * 1.06) * lighting;
  } else if (isShell) {
    // The painted shell. **No pattern is added here**: a stack's or a water tank's conviction
    // comes from its silhouette and one clean colour, and any extra line is noise.
    //
    // The factor lives in parts.ts as SHELL_LIFT and **has to be >= 1**: below 1 this branch merely
    // swaps one grey for another and white still renders beige-grey, as at 0.90. Note: no
    // backticks here — the whole GLSL block lives inside a template literal.
    float lift = ${glslFloat(SHELL_LIFT.BASE)} + ${glslFloat(SHELL_LIFT.TOP)} * max(n.y, 0.0);
    color = vBldgColor * lift * lighting;
  } else if (isWater) {
    // A three-segment ramp — **sludge, deep water, shallow water** — selected by the B channel.
    //
    // With only deep to pale blue, sewage's earth colour does not exist on the ramp and shade at 0
    // is still very dark blue. The turning point lives in parts.ts as WATER_MURK_MAX, and both
    // plants' shade values are tested against it.
    //
    // The shimmer is two sine waves of different frequencies multiplied together and moving over
    // time: a static patch reads in an isometric view as coloured flooring rather than water.
    vec3 murk = vec3(0.34, 0.27, 0.14);
    vec3 deep = vec3(0.05, 0.18, 0.34);
    vec3 shallow = vec3(0.13, 0.42, 0.66);
    float wave = sin(vWorldPos.x * 7.0 + uTime * 0.55)
      * sin(vWorldPos.z * 5.0 - uTime * 0.41);
    float s = clamp(vGroundShade + wave * 0.1, 0.0, 1.0);
    float murkMax = ${glslFloat(WATER_MURK_MAX)};
    color = s < murkMax
      ? mix(murk, deep, s / murkMax)
      : mix(deep, shallow, (s - murkMax) / (1.0 - murkMax));
    color *= lighting;
    // Water reflects the sky, far more weakly than glass; without it, water at night is pure
    // black.
    glassiness = 0.35;
  } else if (isGround) {
    // Asphalt to concrete to brick, selected by the vertex B channel, with a little
    // world-coordinate noise so a large paved area is not one flat block of colour.
    vec3 tarmac = vec3(0.20, 0.20, 0.21);
    vec3 paving = vec3(0.60, 0.58, 0.55);
    float grain = hash21(floor(vWorldPos.xz * 26.0)) * 0.07 - 0.035;
    color = (mix(tarmac, paving, vGroundShade) + grain) * lighting;
  } else if (isFloor) {
    color = vBldgColor * 0.3;
  } else if (isRoof) {
    float rh = hash21(floor(vWorldPos.xz * 1.01));
    color = getRoofColor(vZoneCat, rh);
    color *= lighting;
  } else {
    // === WALL — zone-specific patterns ===
    // Each building's own facade rhythm. As constants, every tower in the city shares one window
    // grid, and however the masses vary the facades still read as one building.
    float seedRhythm = vSeed.x;
    // The phase offset moves the starting point without changing the scale: windows keep their
    // real-world size, and neighbouring buildings' windows stop aligning into one horizontal
    // line.
    float phase = vSeed.y * 10.0;
    // The storey height's value lives in propBands.FLOOR_HEIGHT_UNITS. With the geometry, which
    // decides where a canopy hangs, disagreeing with the shader, which decides where a window is
    // drawn, the canopy lands across the middle of a window and nothing reports it.
    float floorHeight = mix(${glslFloat(FLOOR_HEIGHT_UNITS.MIN)}, ${glslFloat(FLOOR_HEIGHT_UNITS.MAX)}, seedRhythm);
    float windowWidth = mix(0.16, 0.24, seedRhythm);
    float y = vWorldPos.y;
    float wallU;
    if (abs(n.x) > abs(n.z)) {
      wallU = vWorldPos.z;
    } else {
      wallU = vWorldPos.x;
    }
    bool onWall = abs(n.y) < 0.3 && y > 0.06;
    // Occupancy-adjusted lit threshold: fewer lit windows when building is less occupied
    // occ=0 → no windows lit at all (abandoned/burned/empty buildings)
    float occ = vOccupancy < 0.01 ? -1.0 : clamp(vOccupancy, 0.0, 1.0);
    // Civic buildings' night semantics differ from zoned buildings': nobody lives in them, so how
    // many people are inside means nothing, and what darkens one is **a power cut**. So
    // aOccupancy on a civic building carries whether it has power rather than a utilisation
    // rate.
    bool powered = occ > 0.0;
    // The lit-window threshold when powered. It is the residential rule's value at 85% occupancy:
    // high-density residential is mix(0.95, 0.4, occ), and 0.85 gives 0.4825 — about half the
    // windows lit rather than 85% of them.
    //
    // The two differ considerably: 85% lit still reads as a glowing slab, and only half lit reads
    // as some on and some off, which is what is wanted.
    //
    // Which windows are lit changes with uTime's epoch (see the individual branches) on a 150 to
    // 300 second period: the switching is slow, at the same rhythm as residential.
    //
    // Note: no backticks here — the whole GLSL block lives inside a template literal.
    float civicDark = 0.4825;

${facadeChainGlsl()}
  }

  // Apply shadow from directional light
  float shadowVal = 1.0;
  float rawShadow = 1.0;
  #if NUM_DIR_LIGHT_SHADOWS > 0
    rawShadow = getShadow(
      directionalShadowMap[0],
      directionalLightShadows[0].shadowMapSize,
      directionalLightShadows[0].shadowIntensity,
      directionalLightShadows[0].shadowBias,
      directionalLightShadows[0].shadowRadius,
      vDirectionalShadowCoord[0]
    );
    // Shadow only attenuates direct light (like built-in PBR materials)
    float shadowFactor = 0.45 + 0.55 * rawShadow;
    shadowVal = mix(1.0, shadowFactor, directRatio);
    color *= shadowVal;
  #endif

  // The day-night factor is computed **outside** the windowMask test: signage and lamp heads have
  // no windows and still need to know whether it is night.
  // Per-building random offset so lights turn on gradually during dusk
  float bldgRand = fract(sin(dot(floor(vWorldPos.xz), vec2(12.9898, 78.233))) * 43758.5453);
  float onOffset = bldgRand * 0.3; // stagger over 0.3 sunIntensity range
  float dayFactor = smoothstep(0.25 + onOffset, 0.55 + onOffset, sunIntensity);
  float nightFactor = 1.0 - smoothstep(0.15 + onOffset, 0.5 + onOffset, sunIntensity);

  // Window day/night appearance
  if (windowMask > 0.01) {
    // Daytime: all windows show blue-white glass reflection
    vec3 dayGlass = vec3(0.6, 0.72, 0.82);
    color = mix(color, dayGlass * lighting * shadowVal, dayFactor * windowMask * glassiness);
    // Specular sun reflection on sun-facing glass only
    vec3 viewDirH = normalize(vec3(cameraPosition.x - vWorldPos.x, 0.0, cameraPosition.z - vWorldPos.z));
    vec3 sunDirH = normalize(vec3(sunDir.x, 0.0, sunDir.z));
    float facingSun = max(dot(n, sunDirH), 0.0);
    vec3 halfDirH = normalize(sunDirH + viewDirH);
    float spec = pow(max(dot(n, halfDirH), 0.0), 24.0);
    color += spec * sunColor * 0.8 * dayFactor * windowMask * glassiness * facingSun * rawShadow;
    // Nighttime: only lit windows show warm yellow glow
    if (isLitWindow) {
      vec3 warmGlow = vec3(0.95, 0.85, 0.5);
      color = mix(color, warmGlow * 1.35 * winBrightness, nightFactor * 0.7);
    }
  }

  // Emissive light is added after shadowing: a lamp or a sign is a light source itself, and being
  // shadowed by its own building makes no sense.
  color += emissive * nightFactor;

  // Underground mode: white model effect (fade to near-white)
  if (uDesaturate > 0.0) {
    color = mix(color, vec3(0.88), uDesaturate);
  }

  // Highlight tint (demolish / zone selection / hover / coverage gradient)
  if (vHighlight > 0.01) {
    color = mix(color, vHighlightColor, 0.28 * vHighlight);
    // Add emissive glow so it's visible at night too
    color += vHighlightColor * 0.15 * vHighlight;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

function createBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
      ]),
      uGlobalOpacity: { value: 1.0 },
      uDesaturate: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    vertexColors: true,
    lights: true,
    transparent: true,
  });
}

let _buildingMaterial: THREE.ShaderMaterial | null = null;
export function getBuildingMaterial(): THREE.ShaderMaterial {
  if (!_buildingMaterial) _buildingMaterial = createBuildingMaterial();
  return _buildingMaterial;
}

/** For tests: clears the singleton so the next getBuildingMaterial rebuilds it. */
export function resetBuildingMaterial(): void {
  _buildingMaterial = null;
}

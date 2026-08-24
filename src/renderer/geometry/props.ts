import * as THREE from 'three';
import { tagPart, PART_DETAIL, PART_LAMP } from './buildings/parts';
import { M } from './buildings/massing/metrics';
import {
  columnarTree, shrubBall, topiary, flowerBed, hedge,
} from './plants';

/**
 * Street furniture and industrial clutter: the manufactured low props.
 *
 * Planting is in `plants.ts`; this is everything else — lamps, bins, bike racks, bollards, fences,
 * sign posts, mailboxes, hydrants, flagpoles, and industry's drums, pipe racks, gas bottles and
 * pallets.
 *
 * Separated for the same reason as `plants.ts`: these were bound to "the cell's prop band", taking
 * `band`, `axis`, `sign` and `t`, while civic buildings occupy 2x2 to 9x6 cells and have no ring
 * at all — and every low prop should be shared.
 *
 * **This module does not know who calls it.** It takes world coordinates and sizes in cells: the
 * residential side computes coordinates from its band and then calls in, while civic buildings
 * pass coordinates directly.
 *
 * `axis` is always **the direction the object extends**: `'z'` means it runs along world x. That
 * apparently inverted convention comes from the residential side's "along which edge of the cell",
 * and both sides use it so that nobody has to translate in their head.
 */

export type PropAxis = 'x' | 'z';

/** A continuous strip: a low wall, a planter edge, a kerb. Tagged `PART_DETAIL` for the metal-grey branch. */
export function strip(
  x: number, z: number, axis: PropAxis,
  length: number, depth: number, heightM: number, part = PART_DETAIL,
): THREE.BufferGeometry {
  const h = M(heightM);
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(length, h, depth)
    : new THREE.BoxGeometry(depth, h, length);
  geo.translate(x, h / 2, z);
  tagPart(geo, part);
  return geo;
}

/** A mailbox: a post and a box. */
export function mailbox(x: number, z: number): THREE.BufferGeometry[] {
  const post = new THREE.BoxGeometry(M(0.12), M(1.0), M(0.12));
  post.translate(x, M(0.5), z);
  tagPart(post, PART_DETAIL);
  const box = new THREE.BoxGeometry(M(0.34), M(0.24), M(0.22));
  box.translate(x, M(1.12), z);
  tagPart(box, PART_DETAIL);
  return [post, box];
}

/** A bin. */
export function bin(x: number, z: number, radius: number): THREE.BufferGeometry[] {
  const body = new THREE.CylinderGeometry(radius, radius * 0.85, M(0.9), 5);
  body.translate(x, M(0.45), z);
  tagPart(body, PART_DETAIL);
  const lid = new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, M(0.08), 5);
  lid.translate(x, M(0.94), z);
  tagPart(lid, PART_DETAIL);
  return [body, lid];
}

/** One bollard. Square rather than round: at 0.11 m the difference is invisible in an isometric view, and a cylinder costs 80% more. */
export function bollard(x: number, z: number, radius: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(radius * 1.7, M(0.85), radius * 1.7);
  post.translate(x, M(0.425), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** One fence post, thinner than a bollard. */
export function fencePost(x: number, z: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(M(0.1), M(1.0), M(0.1));
  post.translate(x, M(0.5), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** A fence rail. */
export function fenceRail(
  x: number, z: number, axis: PropAxis, span: number,
): THREE.BufferGeometry {
  const rail = axis === 'z'
    ? new THREE.BoxGeometry(span, M(0.1), M(0.06))
    : new THREE.BoxGeometry(M(0.06), M(0.1), span);
  rail.translate(x, M(0.72), z);
  tagPart(rail, PART_DETAIL);
  return rail;
}

/** A bike rack: two half hoops. */
export function bikeRack(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const off of [-M(0.35), M(0.35)]) {
    const hoop = new THREE.TorusGeometry(M(0.32), M(0.045), 3, 5, Math.PI);
    hoop.rotateY(axis === 'z' ? 0 : Math.PI / 2);
    hoop.translate(axis === 'z' ? x + off : x, 0, axis === 'z' ? z : z + off);
    tagPart(hoop, PART_DETAIL);
    out.push(hoop);
  }
  return out;
}

/**
 * A garden or street lamp.
 *
 * The pole is cold metal (`PART_DETAIL`) and only the **head** glows (`PART_LAMP`); tagging the
 * whole thing as glowing gives a post lit from the ground to the top at night (the lesson of
 * BUG-230).
 */
export function lamp(x: number, z: number, heightM: number): THREE.BufferGeometry[] {
  const pole = new THREE.CylinderGeometry(M(0.07), M(0.09), M(heightM), 4);
  pole.translate(x, M(heightM) / 2, z);
  tagPart(pole, PART_DETAIL);
  const head = new THREE.SphereGeometry(M(0.18), 4, 3);
  head.translate(x, M(heightM) + M(0.14), z);
  tagPart(head, PART_LAMP);
  return [pole, head];
}

/** One drying rack post. */
export function dryingPost(x: number, z: number): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(M(0.09), M(1.7), M(0.09));
  post.translate(x, M(0.85), z);
  tagPart(post, PART_DETAIL);
  return post;
}

/** A drying line. */
export function dryingLine(
  x: number, z: number, axis: PropAxis, span: number, heightM: number,
): THREE.BufferGeometry {
  const line = axis === 'z'
    ? new THREE.BoxGeometry(span, M(0.04), M(0.04))
    : new THREE.BoxGeometry(M(0.04), M(0.04), span);
  line.translate(x, M(heightM), z);
  tagPart(line, PART_DETAIL);
  return line;
}

/** A notice board or sign post. */
export function signPost(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
  const post = new THREE.CylinderGeometry(M(0.06), M(0.06), M(1.6), 5);
  post.translate(x, M(0.8), z);
  tagPart(post, PART_DETAIL);
  const board = axis === 'z'
    ? new THREE.BoxGeometry(M(0.7), M(0.5), M(0.05))
    : new THREE.BoxGeometry(M(0.05), M(0.5), M(0.7));
  board.translate(x, M(1.5), z);
  tagPart(board, PART_DETAIL);
  return [post, board];
}

/** A drum. */
export function drum(x: number, z: number, radius: number): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(radius, radius, M(0.88), 6);
  body.translate(x, M(0.44), z);
  tagPart(body, PART_DETAIL);
  return body;
}

/**
 * A pipe rack: two posts carrying two horizontal pipes.
 *
 * One of the most recognisable things on an industrial site, and it is **horizontal**. Among a
 * layer otherwise made entirely of upright posts, one horizontal piece immediately reads as "a
 * process runs here".
 *
 * Kept under 2 m: any higher and it enters the overhead layer's clearance
 * (`OVERHEAD_CLEARANCE`).
 */
export function pipeRack(
  x: number, z: number, axis: PropAxis, span: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const t of [-span / 2, span / 2]) {
    const post = new THREE.BoxGeometry(M(0.16), M(2.0), M(0.16));
    post.translate(axis === 'z' ? x + t : x, M(1.0), axis === 'z' ? z : z + t);
    tagPart(post, PART_DETAIL);
    out.push(post);
  }
  for (const [h, r] of [[1.35, 0.13], [1.75, 0.1]] as const) {
    const pipe = new THREE.CylinderGeometry(M(r), M(r), span, 4);
    // `CylinderGeometry`'s axis is y, so laying one along an edge means turning it first: a z-axis
    // edge runs along x and an x-axis edge runs along z, the same convention as `strip`.
    if (axis === 'z') pipe.rotateZ(Math.PI / 2);
    else pipe.rotateX(Math.PI / 2);
    pipe.translate(x, M(h), z);
    tagPart(pipe, PART_DETAIL);
    out.push(pipe);
  }
  return out;
}

/** A gas bottle rack: three cylinders against a low frame. */
export function gasBottles(
  x: number, z: number, axis: PropAxis, radius: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= 1; i++) {
    const off = i * M(0.42);
    const body = new THREE.CylinderGeometry(radius, radius, M(1.3), 4);
    body.translate(axis === 'z' ? x + off : x, M(0.65), axis === 'z' ? z : z + off);
    tagPart(body, PART_DETAIL);
    out.push(body);
  }
  const frame = axis === 'z'
    ? new THREE.BoxGeometry(M(1.5), M(0.1), M(0.08))
    : new THREE.BoxGeometry(M(0.08), M(0.1), M(1.5));
  frame.translate(x, M(1.05), z);
  tagPart(frame, PART_DETAIL);
  out.push(frame);
  return out;
}

/**
 * A pallet stack: three wooden pallets.
 *
 * Its length along the edge is not bounded by the band's width: the residential side's band is
 * 0.4 m deep, but 1.2 m fits along the wall. So it is one of the few pieces of goods with real
 * volume that a narrow band can still hold.
 */
export function palletStack(
  x: number, z: number, axis: PropAxis, depth: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const slab = axis === 'z'
      ? new THREE.BoxGeometry(M(1.2), M(0.16), depth)
      : new THREE.BoxGeometry(depth, M(0.16), M(1.2));
    slab.translate(x, M(0.16) * (i + 0.5) + M(0.06) * i, z);
    tagPart(slab, PART_DETAIL);
    out.push(slab);
  }
  return out;
}

/** A hydrant. */
export function hydrant(x: number, z: number): THREE.BufferGeometry[] {
  const body = new THREE.CylinderGeometry(M(0.11), M(0.14), M(0.7), 5);
  body.translate(x, M(0.35), z);
  tagPart(body, PART_DETAIL);
  const cap = new THREE.SphereGeometry(M(0.12), 4, 2);
  cap.translate(x, M(0.72), z);
  tagPart(cap, PART_DETAIL);
  return [body, cap];
}

/** A flagpole. Returned as [flag, pole], matching the residential side's existing implementation. */
export function flagpole(
  x: number, z: number, axis: PropAxis,
): THREE.BufferGeometry[] {
  const pole = new THREE.CylinderGeometry(M(0.06), M(0.08), M(1.9), 5);
  pole.translate(x, M(0.95), z);
  tagPart(pole, PART_DETAIL);
  const flag = axis === 'z'
    ? new THREE.BoxGeometry(M(0.6), M(0.36), M(0.03))
    : new THREE.BoxGeometry(M(0.03), M(0.36), M(0.6));
  flag.translate(
    axis === 'z' ? x + M(0.32) : x,
    M(1.62),
    axis === 'z' ? z : z + M(0.32),
  );
  tagPart(flag, PART_DETAIL);
  return [flag, pole];
}

// ===== Declarative interface =====

/**
 * The declaration of one low prop.
 *
 * The functions above take coordinates and sizes, which suits the residential side, where
 * coordinates come from the band. Civic buildings are **declarative** — one building is one table
 * — so they need a form that can be written into a table.
 *
 * Planting and street furniture share one union: to a caller they are the same thing, "put an
 * object here", and splitting them into two tables only adds a field every building has to
 * remember to fill.
 */
export type PropSpec =
  | { kind: 'tree'; x: number; z: number; heightM: number; crownRadius: number }
  | { kind: 'shrub'; x: number; z: number; radius: number }
  | { kind: 'topiary'; x: number; z: number; radius: number }
  | { kind: 'flowerBed'; x: number; z: number; radius: number }
  | {
    kind: 'hedge'; x: number; z: number; axis: PropAxis;
    length: number; depth: number; heightM: number;
  }
  | { kind: 'lamp'; x: number; z: number; heightM: number }
  | { kind: 'bin'; x: number; z: number; radius: number }
  | { kind: 'bikeRack'; x: number; z: number; axis: PropAxis }
  | { kind: 'bollard'; x: number; z: number; radius: number }
  | { kind: 'hydrant'; x: number; z: number }
  | { kind: 'flagpole'; x: number; z: number; axis: PropAxis }
  | { kind: 'signPost'; x: number; z: number; axis: PropAxis }
  | { kind: 'mailbox'; x: number; z: number }
  | { kind: 'drum'; x: number; z: number; radius: number }
  | { kind: 'pipeRack'; x: number; z: number; axis: PropAxis; span: number }
  | { kind: 'gasBottles'; x: number; z: number; axis: PropAxis; radius: number }
  | { kind: 'palletStack'; x: number; z: number; axis: PropAxis; depth: number }
  | { kind: 'fence'; x: number; z: number; axis: PropAxis; length: number };

/** Fence post spacing in cells, 2 m. Any sparser and the rail reads as sagging. */
const FENCE_POST_SPACING = M(2.0);
/** A fence post's edge length, matching the one inside `fencePost`. */
const FENCE_POST_W = M(0.1);

/**
 * One run of fence: evenly spaced posts plus a rail.
 *
 * The post count grows with the length; fixed at three, a 30 m fence leaves two long unsupported
 * rails sagging across the middle. The primitives themselves (`fencePost` and `fenceRail`) are
 * shared with the residential side.
 */
function fenceRun(
  x: number, z: number, axis: PropAxis, length: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [fenceRail(x, z, axis, length)];
  // The end posts are inset by half a post width so the run occupies **exactly** `length`. With
  // post centres on the endpoints it reaches half a post further, and two fences meeting at a
  // corner enter each other.
  const run = length - FENCE_POST_W;
  const spans = Math.max(1, Math.round(run / FENCE_POST_SPACING));
  for (let i = 0; i <= spans; i++) {
    const t = -run / 2 + (run * i) / spans;
    out.push(axis === 'z' ? fencePost(x + t, z) : fencePost(x, z + t));
  }
  return out;
}

/** This object's geometry. */
export function propGeometry(p: PropSpec): THREE.BufferGeometry[] {
  switch (p.kind) {
    case 'tree': return columnarTree(p.x, p.z, p.heightM, p.crownRadius);
    case 'shrub': return [shrubBall(p.x, p.z, p.radius)];
    case 'topiary': return topiary(p.x, p.z, p.radius);
    case 'flowerBed': return flowerBed(p.x, p.z, p.radius);
    case 'hedge': return [hedge(p.x, p.z, p.axis, p.length, p.depth, p.heightM)];
    case 'lamp': return lamp(p.x, p.z, p.heightM);
    case 'bin': return bin(p.x, p.z, p.radius);
    case 'bikeRack': return bikeRack(p.x, p.z, p.axis);
    case 'bollard': return [bollard(p.x, p.z, p.radius)];
    case 'hydrant': return hydrant(p.x, p.z);
    case 'flagpole': return flagpole(p.x, p.z, p.axis);
    case 'signPost': return signPost(p.x, p.z, p.axis);
    case 'mailbox': return mailbox(p.x, p.z);
    case 'drum': return [drum(p.x, p.z, p.radius)];
    case 'pipeRack': return pipeRack(p.x, p.z, p.axis, p.span);
    case 'gasBottles': return gasBottles(p.x, p.z, p.axis, p.radius);
    case 'palletStack': return palletStack(p.x, p.z, p.axis, p.depth);
    case 'fence': return fenceRun(p.x, p.z, p.axis, p.length);
  }
}

/**
 * How wide this object is on each of x and z: half-widths, in cells.
 *
 * Civic buildings use it for the plot check. **Over-report rather than under-report**:
 * under-reported, the object reaches out over a neighbouring cell, while over-reporting only
 * stands it further from the boundary.
 */
export function propExtent(p: PropSpec): { x: number; z: number } {
  const iso = (r: number) => ({ x: r, z: r });
  // Objects extending along `axis`: `'z'` means along world x (see the convention at the top of
  // this file).
  const along = (len: number, thick: number, axis: PropAxis) =>
    (axis === 'z' ? { x: len / 2, z: thick } : { x: thick, z: len / 2 });

  switch (p.kind) {
    case 'tree': return iso(p.crownRadius);
    case 'shrub': return iso(p.radius);
    case 'topiary': return iso(p.radius);
    case 'flowerBed': return iso(p.radius);
    case 'hedge': return along(p.length, p.depth / 2, p.axis);
    case 'lamp': return iso(M(0.18));
    case 'bin': return iso(p.radius * 1.1);
    // The two hoops are offset 0.35 m each, with a hoop radius of 0.32 m.
    case 'bikeRack': return along(M(1.34), M(0.37), p.axis);
    case 'bollard': return iso(p.radius * 0.85);
    case 'hydrant': return iso(M(0.14));
    // The flag reaches 0.32 m along +x (or +z), plus half the flag's width.
    case 'flagpole': return along(M(1.0), M(0.5), p.axis);
    case 'signPost': return along(M(0.7), M(0.06), p.axis);
    case 'mailbox': return iso(M(0.17));
    case 'drum': return iso(p.radius);
    case 'pipeRack': return along(p.span, M(0.08), p.axis);
    case 'gasBottles': return along(M(1.5), p.radius, p.axis);
    case 'palletStack': return along(M(1.2), p.depth / 2, p.axis);
    // Posts are 0.1 m square and the rail 0.06 m, so the thickness takes the post's half-width.
    case 'fence': return along(p.length, M(0.05), p.axis);
  }
}

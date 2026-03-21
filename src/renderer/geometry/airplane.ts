import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** Strip uv attribute so all parts can merge (custom BufferGeometry has no uv). */
function stripUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  return geo;
}

/** Set uniform normal for all vertices (avoids computeVertexNormals averaging front+back faces). */
function setNormals(geo: THREE.BufferGeometry, nx: number, ny: number, nz: number): void {
  const count = geo.attributes.position!.count;
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

/**
 * 737-style airplane — cylindrical fuselage, hemisphere nose, upsweep tail,
 * swept wings, underwing engines with pylons, tiny nav lights.
 * Faces +X direction. Vertex colors built-in.
 */
export function buildAirplaneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // ── Constants ──
  const R = 0.06;        // fuselage radius
  const FUSE_LEN = 0.72; // cylindrical section length
  const SEGS = 8;        // circumference segments
  const TOP_Y = R * 2;   // fuselage top = diameter above ground

  // ── Fuselage: cylinder along X ──
  const fuse = stripUV(new THREE.CylinderGeometry(R, R, FUSE_LEN, SEGS));
  fuse.rotateZ(Math.PI / 2); // align along X
  fuse.translate(0, R, 0);
  setVertexColors(fuse, 0.96, 0.96, 0.96);
  parts.push(fuse);

  // ── Nose: egg-shaped hemisphere ──
  const nose = stripUV(new THREE.SphereGeometry(R, SEGS, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  nose.rotateZ(-Math.PI / 2); // point +X
  nose.scale(1.6, 1, 1);      // stretch along X → egg shape
  nose.translate(FUSE_LEN / 2, R, 0);
  setVertexColors(nose, 0.96, 0.96, 0.96);
  parts.push(nose);

  // ── Cockpit window: horizontal band on egg surface ──
  // Fixed Y rows (horizontal, no downward curve), X solved from egg equation:
  // ((x-cx)/(1.6R))² + ((y-cy)/R)² + (z/R)² = 1
  // x = cx + 1.6R × sqrt(1 - ((y-cy)/R)² - (z/R)²)
  {
    const cx = FUSE_LEN / 2;
    const cy = R;
    const eggR = R + 0.003;
    const eggRx = 1.6 * eggR;
    const yVals = [cy + eggR * 0.55, cy + eggR * 0.45, cy + eggR * 0.35]; // rows: top → bottom (narrower band)
    const zVals = [-0.045, -0.022, 0, 0.022, 0.045]; // cols: left → right
    const rows = yVals.length;
    const cols = zVals.length;
    const verts = new Float32Array(rows * cols * 3);
    for (let r = 0; r < rows; r++) {
      const y = yVals[r]!;
      for (let c = 0; c < cols; c++) {
        const z = zVals[c]!;
        const i = (r * cols + c) * 3;
        // Solve X from egg surface equation
        const dy = (y - cy) / eggR;
        const dz = z / eggR;
        const inside = 1 - dy * dy - dz * dz;
        verts[i]     = cx + eggRx * Math.sqrt(Math.max(0, inside));
        verts[i + 1] = y;
        verts[i + 2] = z;
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = r * cols + c;
        const tr = tl + 1;
        const bl = tl + cols;
        const br = bl + 1;
        // Front face + back face (double-sided)
        indices.push(tl, bl, tr, tr, bl, br);
        indices.push(tl, tr, bl, tr, br, bl);
      }
    }
    const windGeo = new THREE.BufferGeometry();
    windGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    windGeo.setIndex(indices);
    windGeo.computeVertexNormals();
    setVertexColors(windGeo, 0.08, 0.12, 0.22);
    parts.push(windGeo);
  }

  // ── Passenger window stripes (thin band on each side of fuselage) ──
  {
    const bandH = 0.010;  // band height
    const bandLen = FUSE_LEN * 0.80; // slightly shorter than fuselage
    const bandX = -FUSE_LEN * 0.05;  // slightly aft of center
    const bandOffset = R + 0.002;     // just outside cylinder surface
    for (const side of [-1, 1]) {
      const bandGeo = new THREE.BufferGeometry();
      bandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        bandX + bandLen / 2, R + R * 0.35 + bandH / 2, side * bandOffset,  // 0: front-top
        bandX + bandLen / 2, R + R * 0.35 - bandH / 2, side * bandOffset,  // 1: front-bottom
        bandX - bandLen / 2, R + R * 0.35 + bandH / 2, side * bandOffset,  // 2: rear-top
        bandX - bandLen / 2, R + R * 0.35 - bandH / 2, side * bandOffset,  // 3: rear-bottom
      ]), 3));
      bandGeo.setIndex([0, 2, 1, 1, 2, 3, 0, 1, 2, 1, 3, 2]); // double-sided
      setNormals(bandGeo, 0, 0, side); // outward facing
      setVertexColors(bandGeo, 0.15, 0.20, 0.30);
      parts.push(bandGeo);
    }
  }

  // ── Tail upsweep: bottom rises, top stays flush with fuselage upper edge ──
  // Custom BufferGeometry — a wedge shape tapering from circular cross-section
  // to a point, with the top edge aligned to fuselage top.
  const tailLen = 0.16;
  const tailX = -FUSE_LEN / 2;
  const tailTip = tailX - tailLen;
  // 4 faces: top, left, right, bottom-left, bottom-right
  const tv = new Float32Array([
    // Top-left at fuselage end
    tailX,   TOP_Y,     -R * 0.7,   // 0
    // Top-right at fuselage end
    tailX,   TOP_Y,      R * 0.7,   // 1
    // Bottom-left at fuselage end
    tailX,   R * 0.3,   -R * 0.7,   // 2
    // Bottom-right at fuselage end
    tailX,   R * 0.3,    R * 0.7,   // 3
    // Tip (top, flush with fuselage top)
    tailTip, TOP_Y,      0,          // 4
    // Tip bottom (upsweep — raised to near top)
    tailTip, TOP_Y * 0.7, 0,         // 5
  ]);
  const ti = [
    // Top face
    0, 4, 1,
    // Left face
    0, 2, 5,  0, 5, 4,
    // Right face
    1, 4, 5,  1, 5, 3,
    // Bottom face
    2, 3, 5,
  ];
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tv, 3));
  tailGeo.setIndex(ti);
  tailGeo.computeVertexNormals();
  setVertexColors(tailGeo, 0.93, 0.93, 0.93);
  parts.push(tailGeo);

  // Vertical tail is in separate geometry (buildAirplaneVTailGeometry) for independent coloring

  // ── Horizontal tail (single piece, double-sided, swept trapezoid) ──
  {
    const rootChord = 0.10;
    const tipChord = 0.02;       // much narrower than root → visible taper
    const halfSpan = 0.18;
    const leadSweep = 0.03;      // leading edge sweep
    const trailSweep = 0.11;     // trailing edge sweeps more → tip narrower
    const htY = TOP_Y * 0.85;
    const rx = tailX - 0.02;
    const ht = new THREE.BufferGeometry();
    ht.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      rx - leadSweep,   htY,  -halfSpan,    // 0: left tip lead
      rx - trailSweep,  htY,  -halfSpan,    // 1: left tip trail
      rx,               htY,   0,            // 2: root lead
      rx - rootChord,   htY,   0,            // 3: root trail
      rx - leadSweep,   htY,   halfSpan,     // 4: right tip lead
      rx - trailSweep,  htY,   halfSpan,     // 5: right tip trail
    ]), 3));
    ht.setIndex([
      0, 2, 1, 1, 2, 3,  // left top
      2, 4, 3, 3, 4, 5,  // right top
      0, 1, 2, 1, 3, 2,  // left bottom
      2, 3, 4, 3, 5, 4,  // right bottom
    ]);
    setNormals(ht, 0, 1, 0);
    setVertexColors(ht, 0.90, 0.90, 0.90);
    parts.push(ht);
  }

  // ── Main wings (single piece, double-sided, swept trapezoid ~25°) ──
  {
    const rootChord = 0.22;
    const tipChord = 0.03;       // much narrower → strong taper (7:1 ratio)
    const halfSpan = 0.45;
    const leadSweep = 0.16;      // leading edge sweep (larger)
    const trailSweep = 0.28;     // trailing edge sweeps more
    const wingY = R * 0.85;
    const rx = 0.12;             // root lead further forward
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      rx - leadSweep,   wingY,  -halfSpan,   // 0: left tip lead
      rx - trailSweep,  wingY,  -halfSpan,   // 1: left tip trail
      rx,               wingY,   0,           // 2: root lead
      rx - rootChord,   wingY,   0,           // 3: root trail
      rx - leadSweep,   wingY,   halfSpan,    // 4: right tip lead
      rx - trailSweep,  wingY,   halfSpan,    // 5: right tip trail
    ]), 3));
    wing.setIndex([
      0, 2, 1, 1, 2, 3,  // left top
      2, 4, 3, 3, 4, 5,  // right top
      0, 1, 2, 1, 3, 2,  // left bottom
      2, 3, 4, 3, 5, 4,  // right bottom
    ]);
    setNormals(wing, 0, 1, 0);
    setVertexColors(wing, 0.90, 0.90, 0.90);
    parts.push(wing);
  }

  // ── Engines (underwing, with pylons) ──
  {
    const engR = 0.03;
    const engLen = 0.12;
    const engY = R * 0.35;
    const engOffsets = [-0.18, 0.18];
    for (const dz of engOffsets) {
      const nacelle = stripUV(new THREE.CylinderGeometry(engR * 0.85, engR, engLen, 6));
      nacelle.rotateZ(Math.PI / 2);
      nacelle.translate(0.02, engY, dz);
      setVertexColors(nacelle, 0.45, 0.45, 0.45);
      parts.push(nacelle);

      const intake = stripUV(new THREE.CircleGeometry(engR * 0.85, 6));
      intake.rotateY(Math.PI / 2);
      intake.translate(0.02 + engLen / 2, engY, dz);
      setVertexColors(intake, 0.25, 0.25, 0.25);
      parts.push(intake);
    }
  }

  return mergeGeometries(parts)!;
}

/**
 * Nav lights as a separate geometry (rendered with MeshBasicMaterial, blinks).
 * Must match the same local coordinate system as buildAirplaneGeometry.
 */
export function buildAirplaneNavLightsGeometry(): THREE.BufferGeometry {
  const R = 0.06;
  const TOP_Y = R * 2;
  const FUSE_LEN = 0.72;
  const tailX = -FUSE_LEN / 2;
  const navSize = 0.012;
  const wingY = R * 0.85;
  const tipX = 0.12 - 0.16;   // root lead X - leadSweep
  const halfSpan = 0.45;

  const parts: THREE.BufferGeometry[] = [];

  // Port (left) — red
  const navL = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navL.translate(tipX, wingY, -halfSpan);
  setVertexColors(navL, 1.0, 0.1, 0.1);
  parts.push(navL);

  // Starboard (right) — green
  const navR = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navR.translate(tipX, wingY, halfSpan);
  setVertexColors(navR, 0.1, 1.0, 0.1);
  parts.push(navR);

  // Tail — white (top of vertical tail)
  const navT = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navT.translate(tailX - 0.04, TOP_Y + 0.14, 0);
  setVertexColors(navT, 1.0, 1.0, 1.0);
  parts.push(navT);

  return mergeGeometries(parts)!;
}

/**
 * Vertical tail as separate geometry (rendered with per-instance airline tail color).
 * White vertex colors so instance color shows through cleanly.
 */
export function buildAirplaneVTailGeometry(): THREE.BufferGeometry {
  const R = 0.06;
  const TOP_Y = R * 2;
  const FUSE_LEN = 0.72;
  const tailX = -FUSE_LEN / 2;
  const baseChord = 0.14;
  const height = 0.15;
  const leadSweep = 0.04;
  const trailSweep = 0.14;

  const vt = new THREE.BufferGeometry();
  vt.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    tailX,               TOP_Y,            0,
    tailX - baseChord,   TOP_Y,            0,
    tailX - leadSweep,   TOP_Y + height,   0,
    tailX - trailSweep,  TOP_Y + height,   0,
  ]), 3));
  vt.setIndex([0, 2, 3, 0, 3, 1, 0, 3, 2, 0, 1, 3]);
  setNormals(vt, 0, 0, 1);
  setVertexColors(vt, 1.0, 1.0, 1.0); // white → instance color = exact tail color
  return vt;
}

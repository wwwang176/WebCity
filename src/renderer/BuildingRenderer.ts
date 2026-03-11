import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { ZoneType } from '../core/grid/types';
import { getInfraConfig, type InfraType as InfraConfigType } from '../core/building/InfraConfig';
import { ViewMode } from '../core/ViewMode';
import { RESERVED_TO_ROTATION } from '../core/building/InfraPlacement';

// ===== Deterministic pseudo-random based on position =====
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ===== Part tagging via vertex colors =====
// R = part type (0=wall, 1=roof), G = zone category, B = reserved
const PART_WALL = 0.0;
const PART_FOLIAGE = 0.5;
const PART_ROOF = 1.0;

function tagPart(geo: THREE.BufferGeometry, part: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = part;
    arr[i * 3 + 1] = 0; // zone set later
    arr[i * 3 + 2] = 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// Zone category constants (encoded in vertex color G channel)
const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
};

function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}

// ===== Color Palettes (realistic, zone-distinguishable) =====
const ZONE_PALETTES: Record<number, number[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [
    0xf0ece4, // white render
    0xe8e0d0, // warm cream
    0xc47050, // red brick
    0xd4a870, // buff/sandstone
    0xe0d8c8, // pale ivory
    0xb85838, // dark red brick
    0xd8c8a0, // honey stone
    0xe8dcd0, // off-white
    0xc8906c, // salmon brick
    0xd0c4a8, // pale yellow stone
    0xf0e8dc, // bright cream
    0xa86040, // terracotta brick
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    0xe0d4b8, // Paris cream stone
    0xc8c0b0, // warm gray
    0xd8ccac, // pale yellow stone
    0xb87858, // Amsterdam brick
    0xe4dcd0, // off-white plaster
    0xd0c4a0, // honey limestone
    0xc4a880, // sandstone
    0xd8d0c0, // light cream
  ],
  [ZoneType.COMMERCIAL_LOW]:   [
    0xd8c888, // warm yellow
    0xe8e0d0, // white plaster
    0xc87050, // brick red
    0xb8c8d8, // pale blue
    0xd4c4a0, // warm cream
    0xd0b870, // golden
    0xe0d0b8, // light sand
    0xc0a878, // tan
  ],
  [ZoneType.COMMERCIAL_HIGH]:  [
    0x78a8c0, // blue-green glass
    0xc8b890, // warm limestone
    0x88b0a0, // green glass
    0xa0a8b0, // steel gray
    0xd8d4d0, // white modern
    0x90a8b8, // light blue glass
    0xb8a880, // sandstone classic
    0x80a0b8, // teal glass
  ],
  [ZoneType.INDUSTRIAL]:       [
    0xb0b4b8, // silver metal
    0xa86048, // red brick factory
    0xd0ccc8, // white panel
    0xa07050, // rust/corten steel
    0x808480, // dark gray
    0xc0b8b0, // light concrete
    0x907060, // weathered brick
    0xb8b0a0, // beige concrete
  ],
  [ZoneType.OFFICE]:           [
    0x88b0c8, // light blue glass
    0x607890, // deep blue glass
    0xc8ccd0, // white modern
    0xb8a890, // warm stone base
    0x80a8a0, // green glass
    0xa0b4c0, // steel blue
    0x98a8b0, // cool gray
    0x70a0b8, // teal
  ],
};

// ===== Height ranges per zone =====
const ZONE_HEIGHTS: Record<number, { min: number; max: number }> = {
  [ZoneType.RESIDENTIAL_LOW]:  { min: 0.25, max: 0.7 },
  [ZoneType.RESIDENTIAL_HIGH]: { min: 1.0, max: 3.0 },
  [ZoneType.COMMERCIAL_LOW]:   { min: 0.4, max: 1.0 },
  [ZoneType.COMMERCIAL_HIGH]:  { min: 1.2, max: 2.8 },
  [ZoneType.INDUSTRIAL]:       { min: 0.4, max: 1.0 },
  [ZoneType.OFFICE]:           { min: 1.5, max: 4.5 },
};

// ===== Building Shader =====
const BUILDING_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;

void main() {
  vLocalPos = position;

  #ifdef USE_COLOR
    vPartType = color.r;
    vZoneCat = color.g;
  #else
    vPartType = 0.0;
    vZoneCat = 0.0;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vBldgColor = instanceColor;
  #else
    vBldgColor = vec3(0.7);
  #endif

  #ifdef USE_INSTANCING
    mat4 world = modelMatrix * instanceMatrix;
  #else
    mat4 world = modelMatrix;
  #endif

  vec4 wPos = world * vec4(position, 1.0);
  vWorldPos = wPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = projectionMatrix * viewMatrix * wPos;

  // Shadow map: transformedNormal required by shadowmap_vertex
  vec3 transformedNormal = vNormal;
  vec4 worldPosition = wPos;
  #include <shadowmap_vertex>
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;

#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>

uniform float uGlobalOpacity;
uniform float uDesaturate;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// === Independent roof color palettes per zone ===
vec3 getRoofColor(float zoneCat, float h) {
  // Residential Low: clay tiles, slate
  if (zoneCat < 0.1) {
    if (h < 0.17) return vec3(0.35, 0.22, 0.14); // dark brown tiles
    if (h < 0.33) return vec3(0.58, 0.30, 0.18); // terracotta red
    if (h < 0.50) return vec3(0.40, 0.38, 0.36); // slate gray
    if (h < 0.67) return vec3(0.45, 0.28, 0.16); // warm brown
    if (h < 0.83) return vec3(0.52, 0.34, 0.22); // cedar brown
    return vec3(0.32, 0.30, 0.28);                // dark slate
  }
  // Residential High: Paris zinc, dark slate
  if (zoneCat < 0.3) {
    if (h < 0.25) return vec3(0.45, 0.45, 0.48); // zinc gray
    if (h < 0.50) return vec3(0.30, 0.30, 0.32); // dark slate
    if (h < 0.75) return vec3(0.38, 0.36, 0.34); // warm dark gray
    return vec3(0.35, 0.38, 0.42);                // blue-gray slate
  }
  // Commercial Low: European shop roofs
  if (zoneCat < 0.5) {
    if (h < 0.20) return vec3(0.55, 0.28, 0.16); // terracotta
    if (h < 0.40) return vec3(0.35, 0.22, 0.14); // dark brown
    if (h < 0.60) return vec3(0.38, 0.36, 0.34); // dark gray
    if (h < 0.80) return vec3(0.42, 0.25, 0.15); // warm brown tile
    return vec3(0.30, 0.30, 0.28);                // charcoal
  }
  // Commercial High: flat modern roofs
  if (zoneCat < 0.7) {
    if (h < 0.33) return vec3(0.32, 0.34, 0.36); // dark flat gray
    if (h < 0.66) return vec3(0.38, 0.42, 0.40); // green-gray (copper patina)
    return vec3(0.28, 0.30, 0.32);                // charcoal
  }
  // Industrial: metal roofing
  if (zoneCat < 0.9) {
    if (h < 0.25) return vec3(0.55, 0.56, 0.58); // light silver metal
    if (h < 0.50) return vec3(0.40, 0.40, 0.42); // medium gray metal
    if (h < 0.75) return vec3(0.50, 0.35, 0.25); // rusted metal
    return vec3(0.35, 0.36, 0.38);                // dark metal
  }
  // Office: modern flat roofs
  if (h < 0.33) return vec3(0.30, 0.32, 0.35); // dark gray flat
  if (h < 0.66) return vec3(0.25, 0.28, 0.30); // very dark
  return vec3(0.35, 0.35, 0.38);                // medium gray
}

void main() {
  vec3 n = normalize(vNormal);
  bool isLitWindow = false;

  // Read real lights from Three.js uniforms (set by lights_pars_begin)
  float ambient = (ambientLightColor.r + ambientLightColor.g + ambientLightColor.b) / 3.0;
  #if NUM_DIR_LIGHTS > 0
    vec3 sunDir = normalize(directionalLights[0].direction);
    float sunIntensity = length(directionalLights[0].color);
  #else
    vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
    float sunIntensity = 1.0;
  #endif
  float sunDiff = max(dot(n, sunDir), 0.0);
  vec3 fillDir = normalize(vec3(-0.6, 0.3, -0.4));
  float fillDiff = max(dot(n, fillDir), 0.0);
  float lighting = max(0.08, ambient * 0.7) + (0.45 * sunDiff + 0.13 * fillDiff) * sunIntensity;

  bool isFoliage = vPartType > 0.35 && vPartType < 0.65;
  bool isRoof = vPartType > 0.8 || (n.y > 0.85 && vPartType < 0.1);
  bool isFloor = n.y < -0.85;

  vec3 color;

  if (isFoliage) {
    // Green foliage with variation based on position
    float fh = hash21(vWorldPos.xz * 3.7);
    vec3 baseGreen = mix(vec3(0.18, 0.35, 0.12), vec3(0.25, 0.45, 0.15), fh);
    // Darker at bottom, lighter at top
    float topFade = smoothstep(0.0, 0.25, vWorldPos.y);
    color = baseGreen * (0.7 + 0.3 * topFade);
    color *= lighting;
  } else if (isFloor) {
    color = vBldgColor * 0.3;
  } else if (isRoof) {
    float rh = hash21(floor(vWorldPos.xz * 1.01));
    color = getRoofColor(vZoneCat, rh);
    color *= lighting;
  } else {
    // === WALL — zone-specific patterns ===
    float y = vWorldPos.y;
    float wallU;
    if (abs(n.x) > abs(n.z)) {
      wallU = vWorldPos.z;
    } else {
      wallU = vWorldPos.x;
    }
    bool onWall = abs(n.y) < 0.3 && y > 0.06;

    // ---- RESIDENTIAL LOW: painted siding, no window grid ----
    if (vZoneCat < 0.1) {
      color = vBldgColor * 0.9;
      if (onWall) {
        // Subtle horizontal siding lines
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        color = vBldgColor * (0.88 - line * 0.06);
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }

    // ---- RESIDENTIAL HIGH: medium-spaced windows ----
    else if (vZoneCat < 0.3) {
      float floorH = 0.25;
      float winW = 0.2;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.2 && fracX < 0.8 &&
                   fracY > 0.25 && fracY < 0.68;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.4) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vBldgColor * 0.22 + vec3(0.03, 0.05, 0.08);
        }
      } else if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        color = vBldgColor * 0.72;
      } else {
        color = vBldgColor * 0.88;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- COMMERCIAL LOW: storefront glass bottom, simple wall above ----
    else if (vZoneCat < 0.5) {
      if (onWall && y < 0.22) {
        // Large storefront glass
        float glassU = fract(wallU / 0.25);
        bool inGlass = glassU > 0.06 && glassU < 0.94;
        if (inGlass) {
          float r = hash21(floor(vec2(wallU / 0.25, 0.0)) + vWorldPos.xz * 3.7);
          color = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        } else {
          color = vBldgColor * 0.6; // mullion
        }
      } else if (onWall) {
        // Upper wall — sparse small windows
        float floorH = 0.3;
        float winW = 0.22;
        float fy = y / floorH;
        float fx = wallU / winW;
        float fracY = fract(fy);
        float fracX = fract(fx);
        bool inWin = fracX > 0.3 && fracX < 0.7 && fracY > 0.3 && fracY < 0.65;
        if (inWin) {
          vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 5.3;
          float lit = hash21(wid);
          if (lit > 0.5) {
            color = mix(vec3(0.9, 0.85, 0.6), vec3(0.8, 0.7, 0.45), lit) * 0.8;
            isLitWindow = true;
          } else {
            color = vBldgColor * 0.25 + vec3(0.03, 0.04, 0.08);
          }
        } else {
          color = vBldgColor * 0.85;
        }
      } else {
        color = vBldgColor * 0.85;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- COMMERCIAL HIGH: dense glass curtain wall ----
    else if (vZoneCat < 0.7) {
      float floorH = 0.22;
      float winW = 0.1;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.08 && fracX < 0.92 &&
                   fracY > 0.12 && fracY < 0.82;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.3) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.92, 0.88, 0.65), vec3(0.82, 0.72, 0.42), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vec3(0.35, 0.48, 0.58) * (0.6 + hash21(wid + 33.3) * 0.3);
        }
      } else {
        color = vBldgColor * 0.5; // narrow mullions
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- INDUSTRIAL: corrugated metal, large doors ----
    else if (vZoneCat < 0.9) {
      if (onWall) {
        // Horizontal corrugation ridges
        float ridge = fract(y / 0.08);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.72 + shade * 0.18);

        // Large loading door at ground level
        float doorU = fract(wallU / 0.35);
        if (y < 0.18 && doorU > 0.12 && doorU < 0.88) {
          color = vBldgColor * 0.4 + vec3(0.02, 0.02, 0.01);
          // Horizontal door slats
          float slat = fract(y / 0.03);
          color *= 0.9 + 0.1 * step(0.5, slat);
        }
      } else {
        color = vBldgColor * 0.78;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }

    // ---- OFFICE: dense window grid ----
    else {
      float floorH = 0.25;
      float winW = 0.125;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.15 && fracX < 0.85 &&
                   fracY > 0.2 && fracY < 0.72;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.35) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vBldgColor * 0.2 + vec3(0.03, 0.05, 0.09);
        }
      } else if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        color = vBldgColor * 0.7;
      } else {
        color = vBldgColor * 0.88;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }
  }

  // Apply shadow from directional light
  #if NUM_DIR_LIGHT_SHADOWS > 0
    float shadow = getShadow(
      directionalShadowMap[0],
      directionalLightShadows[0].shadowMapSize,
      directionalLightShadows[0].shadowIntensity,
      directionalLightShadows[0].shadowBias,
      directionalLightShadows[0].shadowRadius,
      vDirectionalShadowCoord[0]
    );
    color *= 0.45 + 0.55 * shadow;
  #endif

  // Night window glow
  if (isLitWindow) {
    float nightFactor = 1.0 - smoothstep(0.0, 0.3, sunIntensity);
    vec3 warmGlow = vec3(0.95, 0.85, 0.5);
    color = mix(color, warmGlow * 0.9, nightFactor * 0.7);
  }

  // Underground mode: white model effect (fade to near-white)
  if (uDesaturate > 0.0) {
    color = mix(color, vec3(0.88), uDesaturate);
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
    },
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    vertexColors: true,
    lights: true,
    transparent: true,
  });
}

let _buildingMaterial: THREE.ShaderMaterial | null = null;
function getBuildingMaterial(): THREE.ShaderMaterial {
  if (!_buildingMaterial) _buildingMaterial = createBuildingMaterial();
  return _buildingMaterial;
}

// ===== Geometry Builders =====

// -- Residential Low: houses with yards/garages --

function makeResLowV1(): THREE.BufferGeometry {
  // House with pitched roof + detached garage
  const body = new THREE.BoxGeometry(0.36, 0.32, 0.34);
  body.translate(-0.08, 0.16, -0.06);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.32, 0.18, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(-0.08, 0.41, -0.06);
  tagPart(roof, PART_ROOF);
  // Garage
  const garage = new THREE.BoxGeometry(0.2, 0.18, 0.22);
  garage.translate(0.22, 0.09, 0.18);
  tagPart(garage, PART_WALL);
  const gRoof = new THREE.BoxGeometry(0.22, 0.03, 0.24);
  gRoof.translate(0.22, 0.195, 0.18);
  tagPart(gRoof, PART_ROOF);
  // Front hedge
  const hedge = new THREE.BoxGeometry(0.3, 0.08, 0.06);
  hedge.translate(-0.08, 0.04, 0.25);
  tagPart(hedge, PART_FOLIAGE);
  // Garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.15, 5);
  trunk.translate(0.28, 0.075, -0.22);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.1, 5, 4);
  canopy.translate(0.28, 0.2, -0.22);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, roof, garage, gRoof, hedge, trunk, canopy])!;
}

function makeResLowV2(): THREE.BufferGeometry {
  // Wide bungalow + garden shed
  const body = new THREE.BoxGeometry(0.5, 0.26, 0.36);
  body.translate(0, 0.13, -0.06);
  tagPart(body, PART_WALL);
  const porch = new THREE.BoxGeometry(0.18, 0.14, 0.1);
  porch.translate(0.18, 0.07, 0.15);
  tagPart(porch, PART_WALL);
  const shed = new THREE.BoxGeometry(0.14, 0.16, 0.14);
  shed.translate(-0.22, 0.08, 0.22);
  tagPart(shed, PART_WALL);
  const shedRoof = new THREE.BoxGeometry(0.16, 0.02, 0.16);
  shedRoof.translate(-0.22, 0.17, 0.22);
  tagPart(shedRoof, PART_ROOF);
  // Side bushes
  const bush1 = new THREE.SphereGeometry(0.06, 5, 4);
  bush1.translate(0.32, 0.06, -0.28);
  tagPart(bush1, PART_FOLIAGE);
  const bush2 = new THREE.SphereGeometry(0.05, 5, 4);
  bush2.translate(0.32, 0.05, -0.16);
  tagPart(bush2, PART_FOLIAGE);
  // Back garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5);
  trunk.translate(-0.08, 0.09, -0.32);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.12, 5, 4);
  canopy.translate(-0.08, 0.24, -0.32);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, porch, shed, shedRoof, bush1, bush2, trunk, canopy])!;
}

function makeResLowV3(): THREE.BufferGeometry {
  // Narrow townhouse with steep roof + small yard wall
  const body = new THREE.BoxGeometry(0.32, 0.4, 0.4);
  body.translate(0, 0.2, -0.04);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.3, 0.22, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.51, -0.04);
  tagPart(roof, PART_ROOF);
  // Low yard wall / fence
  const fence = new THREE.BoxGeometry(0.4, 0.06, 0.03);
  fence.translate(0.05, 0.03, 0.22);
  tagPart(fence, PART_WALL);
  // Front hedge row
  const hedge1 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge1.translate(-0.12, 0.035, 0.22);
  tagPart(hedge1, PART_FOLIAGE);
  const hedge2 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge2.translate(0.22, 0.035, 0.22);
  tagPart(hedge2, PART_FOLIAGE);
  // Corner bush
  const bush = new THREE.SphereGeometry(0.07, 5, 4);
  bush.translate(-0.25, 0.07, 0.28);
  tagPart(bush, PART_FOLIAGE);
  return mergeGeometries([body, roof, fence, hedge1, hedge2, bush])!;
}

// -- Residential High --

function makeResHighV1(): THREE.BufferGeometry {
  const main = new THREE.BoxGeometry(0.6, 0.8, 0.55);
  main.translate(0, 0.4, 0);
  tagPart(main, PART_WALL);
  const top = new THREE.BoxGeometry(0.4, 0.25, 0.35);
  top.translate(0, 0.925, 0);
  tagPart(top, PART_ROOF);
  return mergeGeometries([main, top])!;
}

function makeResHighV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.45, 1.0, 0.45);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  cap.translate(0, 1.03, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

function makeResHighV3(): THREE.BufferGeometry {
  const wing1 = new THREE.BoxGeometry(0.6, 0.7, 0.3);
  wing1.translate(0, 0.35, -0.1);
  tagPart(wing1, PART_WALL);
  const wing2 = new THREE.BoxGeometry(0.3, 0.7, 0.6);
  wing2.translate(-0.15, 0.35, 0.15);
  tagPart(wing2, PART_WALL);
  return mergeGeometries([wing1, wing2])!;
}

// -- Commercial Low --

function makeComLowV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.6, 0.4, 0.55);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const awning = new THREE.BoxGeometry(0.65, 0.03, 0.15);
  awning.translate(0, 0.35, 0.32);
  tagPart(awning, PART_ROOF);
  return mergeGeometries([body, awning])!;
}

function makeComLowV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.7, 0.35, 0.5);
  body.translate(0, 0.175, 0);
  tagPart(body, PART_WALL);
  const sign = new THREE.BoxGeometry(0.55, 0.06, 0.02);
  sign.translate(0, 0.38, 0.26);
  tagPart(sign, PART_ROOF);
  return mergeGeometries([body, sign])!;
}

function makeComLowV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const entry = new THREE.BoxGeometry(0.15, 0.3, 0.08);
  entry.translate(0, 0.15, 0.29);
  tagPart(entry, PART_WALL);
  return mergeGeometries([body, entry])!;
}

// -- Commercial High --

function makeComHighV1(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.6, 0.4, 0.6);
  base.translate(0, 0.2, 0);
  tagPart(base, PART_WALL);
  const tower = new THREE.BoxGeometry(0.45, 0.8, 0.45);
  tower.translate(0, 0.8, 0);
  tagPart(tower, PART_WALL);
  return mergeGeometries([base, tower])!;
}

function makeComHighV2(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.28, 0.3, 1.0, 8);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 8);
  cap.translate(0, 1.025, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

// -- Industrial: factories with yards --

function makeIndV1(): THREE.BufferGeometry {
  // Factory + small utility shed
  const body = new THREE.BoxGeometry(0.5, 0.38, 0.45);
  body.translate(-0.04, 0.19, -0.04);
  tagPart(body, PART_WALL);
  const chimney = new THREE.CylinderGeometry(0.06, 0.08, 0.4, 6);
  chimney.translate(0.15, 0.58, -0.15);
  tagPart(chimney, PART_WALL);
  // Utility shed
  const shed = new THREE.BoxGeometry(0.18, 0.16, 0.2);
  shed.translate(0.26, 0.08, 0.2);
  tagPart(shed, PART_WALL);
  return mergeGeometries([body, chimney, shed])!;
}

function makeIndV2(): THREE.BufferGeometry {
  // Warehouse + loading dock area
  const body = new THREE.BoxGeometry(0.55, 0.28, 0.5);
  body.translate(0, 0.14, -0.05);
  tagPart(body, PART_WALL);
  const dock = new THREE.BoxGeometry(0.3, 0.06, 0.15);
  dock.translate(0, 0.03, 0.28);
  tagPart(dock, PART_WALL);
  return mergeGeometries([body, dock])!;
}

function makeIndV3(): THREE.BufferGeometry {
  // Double chimney factory + yard wall
  const body = new THREE.BoxGeometry(0.48, 0.32, 0.42);
  body.translate(0, 0.16, 0);
  tagPart(body, PART_WALL);
  const ch1 = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6);
  ch1.translate(-0.12, 0.495, -0.12);
  tagPart(ch1, PART_WALL);
  const ch2 = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
  ch2.translate(0.12, 0.47, -0.12);
  tagPart(ch2, PART_WALL);
  // Compound wall
  const wall = new THREE.BoxGeometry(0.5, 0.1, 0.03);
  wall.translate(0, 0.05, 0.26);
  tagPart(wall, PART_WALL);
  return mergeGeometries([body, ch1, ch2, wall])!;
}

// -- Office --

function makeOfficeV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 1.0, 0.5);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const antenna = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4);
  antenna.translate(0, 1.1, 0);
  tagPart(antenna, PART_ROOF);
  return mergeGeometries([body, antenna])!;
}

function makeOfficeV2(): THREE.BufferGeometry {
  const b1 = new THREE.BoxGeometry(0.6, 0.5, 0.6);
  b1.translate(0, 0.25, 0);
  tagPart(b1, PART_WALL);
  const b2 = new THREE.BoxGeometry(0.45, 0.4, 0.45);
  b2.translate(0, 0.7, 0);
  tagPart(b2, PART_WALL);
  const b3 = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  b3.translate(0, 1.05, 0);
  tagPart(b3, PART_ROOF);
  return mergeGeometries([b1, b2, b3])!;
}

function makeOfficeV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.65, 0.8, 0.5);
  body.translate(0, 0.4, 0);
  tagPart(body, PART_WALL);
  const equip = new THREE.BoxGeometry(0.2, 0.1, 0.15);
  equip.translate(0.15, 0.85, 0.1);
  tagPart(equip, PART_ROOF);
  return mergeGeometries([body, equip])!;
}

// ===== Variant Registry =====
type GeoBuilder = () => THREE.BufferGeometry;

const VARIANTS: Record<number, GeoBuilder[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [makeResLowV1, makeResLowV2, makeResLowV3],
  [ZoneType.RESIDENTIAL_HIGH]: [makeResHighV1, makeResHighV2, makeResHighV3],
  [ZoneType.COMMERCIAL_LOW]:   [makeComLowV1, makeComLowV2, makeComLowV3],
  [ZoneType.COMMERCIAL_HIGH]:  [makeComHighV1, makeComHighV2],
  [ZoneType.INDUSTRIAL]:       [makeIndV1, makeIndV2, makeIndV3],
  [ZoneType.OFFICE]:           [makeOfficeV1, makeOfficeV2, makeOfficeV3],
};

// ===== Infrastructure buildingId markers =====
const INFRA_POWER_ID = 254;
const INFRA_WATER_ID = 253;
const INFRA_POLICE_ID = 252;
const INFRA_FIRE_ID = 251;
const INFRA_HOSPITAL_ID = 250;
const INFRA_SCHOOL_ID = 249;
const INFRA_PARK_ID = 248;
const INFRA_GARBAGE_ID = 247;
const INFRA_SEWAGE_ID = 246;
const INFRA_CEMETERY_ID = 245;
const INFRA_SCHOOL_HIGH_ID = 244;
const INFRA_SCHOOL_UNIV_ID = 243;
// Transport stop buildingIds
const TRANS_BUS_STOP_ID = 242;
const TRANS_METRO_STATION_ID = 241;
const TRANS_TRAM_STOP_ID = 240;
const TRANS_TRAIN_STATION_ID = 239;
const TRANS_FERRY_DOCK_ID = 238;
const TRANS_AIRPORT_ID = 237;
const TRANS_TAXI_STAND_ID = 236;
type InfraType = 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery'
  | 'bus_stop' | 'metro_station' | 'tram_stop' | 'train_station' | 'ferry_dock' | 'airport' | 'taxi_stand';
const INFRA_ID_MAP: Record<number, InfraType> = {
  [INFRA_POWER_ID]: 'power', [INFRA_WATER_ID]: 'water',
  [INFRA_POLICE_ID]: 'police', [INFRA_FIRE_ID]: 'fire', [INFRA_HOSPITAL_ID]: 'hospital',
  [INFRA_SCHOOL_ID]: 'school', [INFRA_SCHOOL_HIGH_ID]: 'school_high', [INFRA_SCHOOL_UNIV_ID]: 'school_univ',
  [INFRA_PARK_ID]: 'park', [INFRA_GARBAGE_ID]: 'garbage', [INFRA_SEWAGE_ID]: 'sewage', [INFRA_CEMETERY_ID]: 'cemetery',
  [TRANS_BUS_STOP_ID]: 'bus_stop', [TRANS_METRO_STATION_ID]: 'metro_station',
  [TRANS_TRAM_STOP_ID]: 'tram_stop', [TRANS_TRAIN_STATION_ID]: 'train_station',
  [TRANS_FERRY_DOCK_ID]: 'ferry_dock', [TRANS_AIRPORT_ID]: 'airport', [TRANS_TAXI_STAND_ID]: 'taxi_stand',
};

interface BuildingData { x: number; y: number; level: number; burned?: boolean }

export class BuildingRenderer {
  private meshes: (THREE.InstancedMesh | THREE.Mesh)[] = [];
  private infraGroups: THREE.Group[] = [];
  private readonly maxPerVariant = 3000;

  // Light spot system (fake ground glow near buildings at night)
  private lightSpotMesh: THREE.InstancedMesh | null = null;
  private lightSpotMaterial: THREE.MeshBasicMaterial | null = null;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const buildingsByZone = new Map<number, BuildingData[]>();
    const emptyZonesByType = new Map<number, { x: number; y: number }[]>();
    const infraCells: { x: number; y: number; type: InfraType; reserved: number }[] = [];

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;

        // Skip secondary cells of multi-cell buildings (reserved=4)
        if (cell.reserved === 4) continue;

        const infraType = INFRA_ID_MAP[cell.buildingId];
        if (infraType) {
          infraCells.push({ x, y, type: infraType, reserved: cell.reserved });
          continue;
        }

        if (cell.zoneType !== ZoneType.NONE) {
          if (cell.buildingId > 0 && cell.buildingId < INFRA_WATER_ID) {
            if (!buildingsByZone.has(cell.zoneType)) buildingsByZone.set(cell.zoneType, []);
            buildingsByZone.get(cell.zoneType)!.push({
              x, y,
              level: Math.max(1, Math.min(3, Math.ceil(cell.serviceCoverage / 3) || 1)),
              burned: cell.reserved === 3, // BuildingStatus.BURNED
            });
          } else if (cell.buildingId === 0) {
            if (!emptyZonesByType.has(cell.zoneType)) emptyZonesByType.set(cell.zoneType, []);
            emptyZonesByType.get(cell.zoneType)!.push({ x, y });
          }
        }
      }
    }

    this.buildInfrastructure(scene, infraCells);
    this.buildZoneOverlays(scene, emptyZonesByType);
    this.buildVariantBuildings(scene, buildingsByZone);

    // Build light spots for all buildings EXCEPT burned ones (no lights in charred ruins)
    const allBuildingPositions: { x: number; y: number }[] = [];
    for (const buildings of buildingsByZone.values()) {
      for (const b of buildings) {
        if (!b.burned) allBuildingPositions.push({ x: b.x, y: b.y });
      }
    }
    for (const inf of infraCells) {
      allBuildingPositions.push({ x: inf.x, y: inf.y });
    }
    this.buildLightSpots(scene, allBuildingPositions);
  }

  private buildVariantBuildings(scene: THREE.Scene, buildingsByZone: Map<number, BuildingData[]>): void {
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const color = new THREE.Color();
    const material = getBuildingMaterial();

    for (const [zoneType, buildings] of buildingsByZone) {
      const variants = VARIANTS[zoneType];
      if (!variants || variants.length === 0) continue;

      const palette = ZONE_PALETTES[zoneType] ?? [0x888888];
      const heightRange = ZONE_HEIGHTS[zoneType] ?? { min: 0.3, max: 1.0 };
      const zoneCat = ZONE_CAT[zoneType] ?? 0;

      const buckets: BuildingData[][] = variants.map(() => []);
      for (const b of buildings) {
        const vi = Math.floor(hash(b.x, b.y) * variants.length) % variants.length;
        buckets[vi]!.push(b);
      }

      for (let vi = 0; vi < variants.length; vi++) {
        const bucket = buckets[vi]!;
        if (bucket.length === 0) continue;

        const geometry = variants[vi]!();
        // Stamp zone category into vertex color G channel
        stampZoneCategory(geometry, zoneCat);

        const count = Math.min(bucket.length, this.maxPerVariant);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        for (let i = 0; i < count; i++) {
          const b = bucket[i]!;
          const h = hash(b.x, b.y);
          const h2 = hash(b.x + 100, b.y + 100);
          const h3 = hash(b.x + 200, b.y + 200);

          const levelFactor = b.level / 3;
          const baseHeight = heightRange.min + (heightRange.max - heightRange.min) * levelFactor;
          const heightVar = 1.0 + (h2 - 0.5) * 0.35;
          const finalHeight = baseHeight * heightVar;

          const widthVar = 0.85 + h3 * 0.3;
          const depthVar = 0.85 + hash(b.x + 300, b.y + 300) * 0.3;

          const rotIndex = Math.floor(hash(b.x + 400, b.y + 400) * 4);
          rotation.makeRotationY((rotIndex * Math.PI) / 2);

          scale.makeScale(widthVar, finalHeight, depthVar);
          matrix.multiplyMatrices(scale, rotation);
          matrix.setPosition(b.x, 0.05, b.y);
          mesh.setMatrixAt(i, matrix);

          if (b.burned) {
            // Charred/burned building: dark gray-black with slight variation
            const burnLightness = 0.08 + h * 0.07; // 0.08 ~ 0.15 (very dark)
            color.setHSL(0.05, 0.1, burnLightness);
          } else {
            const baseColor = palette[Math.floor(h * palette.length) % palette.length]!;
            color.set(baseColor);
            const hsl = { h: 0, s: 0, l: 0 };
            color.getHSL(hsl);
            hsl.h += (h2 - 0.5) * 0.03;
            hsl.s = Math.max(0.05, Math.min(0.6, hsl.s + (h3 - 0.5) * 0.1));
            hsl.l = Math.max(0.3, Math.min(0.85, hsl.l + (h - 0.5) * 0.1));
            color.setHSL(hsl.h, hsl.s, hsl.l);
          }
          mesh.setColorAt(i, color);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  private buildZoneOverlays(scene: THREE.Scene, emptyZonesByType: Map<number, { x: number; y: number }[]>): void {
    const matrix = new THREE.Matrix4();
    for (const [zoneType, cells] of emptyZonesByType) {
      const palette = ZONE_PALETTES[zoneType];
      const baseColor = palette ? palette[0]! : 0x888888;
      const count = Math.min(cells.length, this.maxPerVariant);
      const geometry = new THREE.PlaneGeometry(0.9, 0.9);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        color: baseColor, transparent: true, opacity: 0.35, depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        const c = cells[i]!;
        matrix.setPosition(c.x, 0.02, c.y);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private buildInfrastructure(scene: THREE.Scene, cells: { x: number; y: number; type: InfraType; reserved: number }[]): void {
    for (const inf of cells) {
      // Calculate center position for multi-cell buildings
      const cfg = getInfraConfig(inf.type as InfraConfigType);
      const w = cfg ? cfg.width : 1;
      const h = cfg ? cfg.height : 1;
      const centerX = inf.x + (w - 1) / 2;
      const centerZ = inf.y + (h - 1) / 2;
      const scale = Math.max(w, h); // scale factor for larger buildings

      // Read rotation from primary cell's reserved value
      const rotationDeg = RESERVED_TO_ROTATION[inf.reserved] ?? 0;

      // Create a group at building center, rotate the group, build meshes at local offsets
      const group = new THREE.Group();
      group.position.set(centerX, 0, centerZ);
      if (rotationDeg !== 0) {
        group.rotation.y = (rotationDeg * Math.PI) / 180;
      }

      if (inf.type === 'power') {
        this.buildPowerPlant(group, 0, 0, scale);
      } else if (inf.type === 'water') {
        this.buildWaterPump(group, 0, 0, scale);
      } else {
        this.buildCivicBuilding(group, 0, 0, inf.type, scale);
      }

      scene.add(group);
      this.infraGroups.push(group);
    }
  }

  private buildCivicBuilding(scene: THREE.Scene | THREE.Group, cx: number, cz: number, type: InfraType, scale = 1): void {
    const configs: Record<string, { color: number; height: number; roofColor: number; accent?: number }> = {
      police:      { color: 0x3f51b5, height: 0.40, roofColor: 0x303f9f },
      fire:        { color: 0xd32f2f, height: 0.38, roofColor: 0xb71c1c },
      hospital:    { color: 0xe8e8e8, height: 0.50, roofColor: 0xbbbbbb, accent: 0xe91e63 },
      school:      { color: 0x795548, height: 0.30, roofColor: 0x5d4037 },
      school_high: { color: 0x6d4c41, height: 0.40, roofColor: 0x4e342e },
      school_univ: { color: 0x4e342e, height: 0.55, roofColor: 0x3e2723, accent: 0xffd600 },
      park:        { color: 0x4caf50, height: 0.10, roofColor: 0x388e3c },
      garbage:     { color: 0x795548, height: 0.25, roofColor: 0x5d4037 },
      sewage:      { color: 0x607d8b, height: 0.20, roofColor: 0x455a64 },
      cemetery:    { color: 0x9e9e9e, height: 0.15, roofColor: 0x757575 },
      // Transport stops
      bus_stop:       { color: 0xff9800, height: 0.25, roofColor: 0xf57c00 },
      metro_station:  { color: 0x2196f3, height: 0.30, roofColor: 0x1565c0 },
      tram_stop:      { color: 0x8bc34a, height: 0.22, roofColor: 0x689f38 },
      train_station:  { color: 0x795548, height: 0.45, roofColor: 0x5d4037, accent: 0xff5722 },
      ferry_dock:     { color: 0x00bcd4, height: 0.18, roofColor: 0x00838f },
      airport:        { color: 0xeceff1, height: 0.55, roofColor: 0x90a4ae, accent: 0x2196f3 },
      taxi_stand:     { color: 0xffeb3b, height: 0.20, roofColor: 0xfbc02d },
    };
    const cfg = configs[type] ?? { color: 0x888888, height: 0.35, roofColor: 0x666666 };
    const s = scale; // scale factor for multi-cell buildings
    const bodyW = 0.50 * s;
    const bodyD = 0.50 * s;
    const h = cfg.height * Math.min(s, 2); // height scales but caps at 2x

    // Main building body
    const bodyGeo = new THREE.BoxGeometry(bodyW, h, bodyD);
    bodyGeo.translate(0, h / 2, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color });
    this.addInfraMesh(scene, bodyGeo, bodyMat, cx, 0.05, cz);

    // Roof
    if (type !== 'park') {
      const roofGeo = new THREE.BoxGeometry(bodyW + 0.05 * s, 0.04, bodyD + 0.05 * s);
      roofGeo.translate(0, 0.02, 0);
      const roofMat = new THREE.MeshLambertMaterial({ color: cfg.roofColor });
      this.addInfraMesh(scene, roofGeo, roofMat, cx, h + 0.05, cz);
    }

    // Accent detail (cross for hospital, dome for university, etc.)
    if (cfg.accent && type === 'hospital') {
      const crossH = new THREE.BoxGeometry(0.20 * s, 0.03, 0.06 * s);
      crossH.translate(0, 0.015, 0);
      const crossV = new THREE.BoxGeometry(0.06 * s, 0.03, 0.20 * s);
      crossV.translate(0, 0.015, 0);
      const crossMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, crossH, crossMat, cx, h + 0.09, cz);
      this.addInfraMesh(scene, crossV, crossMat, cx, h + 0.09, cz);
    }
    if (cfg.accent && type === 'school_univ') {
      const domeGeo = new THREE.SphereGeometry(0.12 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, domeGeo, domeMat, cx, h + 0.09, cz);
    }
  }

  private addInfraMesh(scene: THREE.Scene | THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): void {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    scene.add(m);
    this.meshes.push(m);
  }

  private buildPowerPlant(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    const s = scale;
    // --- Main industrial hall ---
    const hallGeo = new THREE.BoxGeometry(0.55, 0.42, 0.6);
    hallGeo.translate(0, 0.21, 0);
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x5a5550 });
    this.addInfraMesh(scene, hallGeo, hallMat, cx - 0.05, 0.05, cz);

    // Metal roof with slight overhang
    const roofGeo = new THREE.BoxGeometry(0.6, 0.035, 0.65);
    roofGeo.translate(0, 0.018, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x484440 });
    this.addInfraMesh(scene, roofGeo, roofMat, cx - 0.05, 0.47, cz);

    // --- Control room annex ---
    const annexGeo = new THREE.BoxGeometry(0.24, 0.28, 0.32);
    annexGeo.translate(0, 0.14, 0);
    const annexMat = new THREE.MeshLambertMaterial({ color: 0x666058 });
    this.addInfraMesh(scene, annexGeo, annexMat, cx + 0.3, 0.05, cz + 0.1);

    const annexRoofGeo = new THREE.BoxGeometry(0.27, 0.025, 0.35);
    annexRoofGeo.translate(0, 0.013, 0);
    this.addInfraMesh(scene, annexRoofGeo, roofMat, cx + 0.3, 0.35, cz + 0.1);

    // --- Tall chimney (back-left) ---
    const ch1Geo = new THREE.CylinderGeometry(0.05, 0.065, 0.6, 8);
    ch1Geo.translate(0, 0.3, 0);
    const chimMat = new THREE.MeshLambertMaterial({ color: 0x8a8580 });
    this.addInfraMesh(scene, ch1Geo, chimMat, cx - 0.15, 0.05, cz - 0.2);

    // Chimney top lip
    const ch1LipGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.035, 8);
    ch1LipGeo.translate(0, 0.018, 0);
    const lipMat = new THREE.MeshLambertMaterial({ color: 0x9a9590 });
    this.addInfraMesh(scene, ch1LipGeo, lipMat, cx - 0.15, 0.65, cz - 0.2, false);

    // Red warning band on tall chimney
    const band1Geo = new THREE.CylinderGeometry(0.056, 0.056, 0.035, 8);
    band1Geo.translate(0, 0.018, 0);
    const redMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    this.addInfraMesh(scene, band1Geo, redMat, cx - 0.15, 0.55, cz - 0.2, false);

    // --- Short chimney (back-right) ---
    const ch2Geo = new THREE.CylinderGeometry(0.04, 0.055, 0.42, 8);
    ch2Geo.translate(0, 0.21, 0);
    const chimMat2 = new THREE.MeshLambertMaterial({ color: 0x7a7570 });
    this.addInfraMesh(scene, ch2Geo, chimMat2, cx + 0.08, 0.05, cz - 0.22);

    // Red warning band on short chimney
    const band2Geo = new THREE.CylinderGeometry(0.046, 0.046, 0.03, 8);
    band2Geo.translate(0, 0.015, 0);
    this.addInfraMesh(scene, band2Geo, redMat, cx + 0.08, 0.42, cz - 0.22, false);

    // --- Yellow warning sign on front wall ---
    const signGeo = new THREE.BoxGeometry(0.1, 0.08, 0.01);
    const signMat = new THREE.MeshLambertMaterial({ color: 0xf0c030 });
    this.addInfraMesh(scene, signGeo, signMat, cx - 0.05, 0.22, cz + 0.31, false);

    // --- Coal pile ---
    const coalMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
    const coal1Geo = new THREE.ConeGeometry(0.11, 0.09, 6);
    coal1Geo.translate(0, 0.045, 0);
    this.addInfraMesh(scene, coal1Geo, coalMat, cx - 0.28, 0.05, cz + 0.3, false);

    const coal2Geo = new THREE.ConeGeometry(0.07, 0.06, 5);
    coal2Geo.translate(0, 0.03, 0);
    this.addInfraMesh(scene, coal2Geo, coalMat, cx - 0.18, 0.05, cz + 0.35, false);

    // --- Status indicator light ---
    const indGeo = new THREE.BoxGeometry(0.07, 0.05, 0.07);
    const indMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });
    this.addInfraMesh(scene, indGeo, indMat, cx + 0.3, 0.39, cz + 0.1, false);
  }

  private buildWaterPump(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    const s = scale;
    // --- Concrete foundation platform ---
    const foundGeo = new THREE.BoxGeometry(0.82, 0.05, 0.82);
    foundGeo.translate(0, 0.025, 0);
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x707a80 });
    this.addInfraMesh(scene, foundGeo, foundMat, cx, 0.02, cz);

    // --- Main pump house ---
    const houseGeo = new THREE.BoxGeometry(0.38, 0.32, 0.45);
    houseGeo.translate(0, 0.16, 0);
    const houseMat = new THREE.MeshLambertMaterial({ color: 0x4a6a7a });
    this.addInfraMesh(scene, houseGeo, houseMat, cx + 0.1, 0.07, cz + 0.02);

    // Pump house roof
    const roofGeo = new THREE.BoxGeometry(0.42, 0.035, 0.49);
    roofGeo.translate(0, 0.018, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a5a6a });
    this.addInfraMesh(scene, roofGeo, roofMat, cx + 0.1, 0.42, cz + 0.02);

    // --- Large water tank (cylinder) ---
    const tankGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.38, 12);
    tankGeo.translate(0, 0.19, 0);
    const tankMat = new THREE.MeshLambertMaterial({ color: 0x29b6f6 });
    this.addInfraMesh(scene, tankGeo, tankMat, cx - 0.22, 0.07, cz - 0.03);

    // Tank top lid
    const lidGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.025, 12);
    lidGeo.translate(0, 0.013, 0);
    const lidMat = new THREE.MeshLambertMaterial({ color: 0x1a8ac0 });
    this.addInfraMesh(scene, lidGeo, lidMat, cx - 0.22, 0.46, cz - 0.03);

    // Tank bottom ring
    const ringGeo = new THREE.CylinderGeometry(0.18, 0.19, 0.035, 12);
    ringGeo.translate(0, 0.018, 0);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x1a7aaa });
    this.addInfraMesh(scene, ringGeo, ringMat, cx - 0.22, 0.07, cz - 0.03);

    // --- Connecting pipe (tank → pump house) ---
    const pipeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6);
    pipeGeo.rotateZ(Math.PI / 2);
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0x607888 });
    this.addInfraMesh(scene, pipeGeo, pipeMat, cx - 0.02, 0.24, cz - 0.03, false);

    // --- Inlet pipe (vertical, from ground) ---
    const inletGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6);
    inletGeo.translate(0, 0.09, 0);
    const inletMat = new THREE.MeshLambertMaterial({ color: 0x4a8898 });
    this.addInfraMesh(scene, inletGeo, inletMat, cx - 0.22, 0.02, cz + 0.22, false);

    // Inlet pipe horizontal elbow
    const elbowGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.16, 6);
    elbowGeo.rotateX(Math.PI / 2);
    this.addInfraMesh(scene, elbowGeo, inletMat, cx - 0.22, 0.2, cz + 0.12, false);

    // --- Control gauge box on pump house wall ---
    const gaugeGeo = new THREE.BoxGeometry(0.07, 0.09, 0.015);
    const gaugeMat = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
    this.addInfraMesh(scene, gaugeGeo, gaugeMat, cx + 0.1, 0.28, cz + 0.26, false);

    // --- Small antenna on roof ---
    const antGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 4);
    antGeo.translate(0, 0.07, 0);
    const antMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.addInfraMesh(scene, antGeo, antMat, cx + 0.2, 0.46, cz - 0.12, false);

    // Antenna red tip
    const tipGeo = new THREE.SphereGeometry(0.013, 4, 4);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    this.addInfraMesh(scene, tipGeo, tipMat, cx + 0.2, 0.6, cz - 0.12, false);

    // --- Status indicator light ---
    const indGeo = new THREE.BoxGeometry(0.06, 0.05, 0.06);
    const indMat = new THREE.MeshBasicMaterial({ color: 0x03a9f4 });
    this.addInfraMesh(scene, indGeo, indMat, cx + 0.1, 0.47, cz + 0.02, false);
  }

  private buildLightSpots(scene: THREE.Scene, positions: { x: number; y: number }[]): void {
    if (positions.length === 0) return;

    const glowRadius = 0.3;
    const glowSegs = 10;
    const geometry = new THREE.CircleGeometry(glowRadius, glowSegs);
    geometry.rotateX(-Math.PI / 2);
    // Radial gradient: center bright, edges fade to black
    const posAttr = geometry.attributes.position!;
    const vColors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / glowRadius;
      const b = Math.max(0, 1 - dist);
      vColors[i * 3] = b;
      vColors[i * 3 + 1] = b;
      vColors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(vColors, 3));

    this.lightSpotMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const count = Math.min(positions.length, this.maxPerVariant);
    this.lightSpotMesh = new THREE.InstancedMesh(geometry, this.lightSpotMaterial, count);
    this.lightSpotMesh.frustumCulled = false;
    this.lightSpotMesh.renderOrder = 2;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const p = positions[i]!;
      matrix.setPosition(p.x, 0.03, p.y);
      this.lightSpotMesh.setMatrixAt(i, matrix);
    }
    this.lightSpotMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.lightSpotMesh);
  }

  /** Update light spot visibility based on sun intensity (call each frame). */
  update(sunIntensity: number): void {
    if (!this.lightSpotMaterial) return;
    if (this._focusMode) {
      this.lightSpotMaterial.opacity = 0;
      return;
    }
    this.lightSpotMaterial.opacity = Math.max(0, 0.4 * (1 - sunIntensity / 0.3));
  }

  private _focusMode = false;
  private _whiteModelMesh: THREE.Mesh | null = null;
  private static _whiteModelMat: THREE.MeshBasicMaterial | null = null;

  private static getWhiteModelMat(): THREE.MeshBasicMaterial {
    if (!BuildingRenderer._whiteModelMat) {
      BuildingRenderer._whiteModelMat = new THREE.MeshBasicMaterial({
        color: 0xe0e0e0,
        opacity: 0.08,
        alphaHash: true,
      });
    }
    return BuildingRenderer._whiteModelMat;
  }

  /** Switch view mode — any non-NORMAL mode shows white model. */
  setViewMode(mode: ViewMode, scene?: THREE.Scene): void {
    const enabled = mode !== ViewMode.NORMAL;
    this._focusMode = enabled;

    if (enabled && scene) {
      // Hide originals
      for (const mesh of this.meshes) mesh.visible = false;
      for (const group of this.infraGroups) group.visible = false;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = false;

      // Build merged white model mesh
      this.buildWhiteModelMesh(scene);
    } else {
      // Remove white model mesh
      if (this._whiteModelMesh && scene) {
        scene.remove(this._whiteModelMesh);
        this._whiteModelMesh.geometry.dispose();
        this._whiteModelMesh = null;
      }

      // Restore originals
      for (const mesh of this.meshes) {
        mesh.visible = true;
        mesh.material = getBuildingMaterial();
        mesh.renderOrder = 0;
      }
      for (const group of this.infraGroups) group.visible = true;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = true;
    }
  }

  /** Bake all building InstancedMeshes + infra into one merged white model mesh. */
  private buildWhiteModelMesh(scene: THREE.Scene): void {
    // Remove old one if exists
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    const geos: THREE.BufferGeometry[] = [];
    const mat4 = new THREE.Matrix4();

    // Bake InstancedMesh instances + plain Mesh (zone overlays)
    for (const mesh of this.meshes) {
      if (mesh instanceof THREE.InstancedMesh) {
        const srcGeo = mesh.geometry;
        const count = mesh.count;
        for (let i = 0; i < count; i++) {
          mesh.getMatrixAt(i, mat4);
          const clone = srcGeo.clone();
          clone.applyMatrix4(mat4);
          clone.deleteAttribute('color');
          geos.push(clone);
        }
      } else {
        const clone = mesh.geometry.clone();
        mesh.updateWorldMatrix(true, false);
        clone.applyMatrix4(mesh.matrixWorld);
        clone.deleteAttribute('color');
        geos.push(clone);
      }
    }

    // Bake infra group meshes
    for (const group of this.infraGroups) {
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const clone = child.geometry.clone();
          child.updateWorldMatrix(true, false);
          clone.applyMatrix4(child.matrixWorld);
          clone.deleteAttribute('color');
          geos.push(clone);
        }
      });
    }

    if (geos.length === 0) return;

    const merged = mergeGeometries(geos, false);
    if (!merged) return;

    // Dispose cloned geos
    for (const g of geos) g.dispose();

    this._whiteModelMesh = new THREE.Mesh(merged, BuildingRenderer.getWhiteModelMat());
    this._whiteModelMesh.renderOrder = 20;
    this._whiteModelMesh.frustumCulled = false;
    scene.add(this._whiteModelMesh);
  }

  dispose(scene: THREE.Scene): void {
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    for (const mesh of this.meshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else if (mat !== getBuildingMaterial()) (mat as THREE.Material).dispose();
    }
    this.meshes = [];

    for (const group of this.infraGroups) {
      scene.remove(group);
    }
    this.infraGroups = [];

    if (this.lightSpotMesh) {
      scene.remove(this.lightSpotMesh);
      this.lightSpotMesh.geometry.dispose();
      if (this.lightSpotMaterial) this.lightSpotMaterial.dispose();
      this.lightSpotMesh = null;
      this.lightSpotMaterial = null;
    }
  }
}

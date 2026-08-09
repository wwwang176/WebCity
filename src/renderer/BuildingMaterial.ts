import * as THREE from 'three';
import { PART_THRESHOLDS } from './geometry/buildings/parts';

/**
 * 把 TS 數字寫成 GLSL 一定會當作 float 的形式 —— 整數在 GLSL 裡不是 float，
 * `vPartType > 1` 會是編譯錯誤。
 */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

// ===== Building Shader =====
export const BUILDING_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

attribute float aHighlight;
attribute vec3 aHighlightColor;
attribute float aOccupancy;
attribute vec3 aSeed;

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
vec3 getRoofColor(float zoneCat, float h) {
  vec3 c = vec3(0.35, 0.35, 0.38); // default (Office: medium gray)
  // Residential Low: clay tiles, slate
  if (zoneCat < 0.1) {
    c = h < 0.17 ? vec3(0.35, 0.22, 0.14) // dark brown tiles
      : h < 0.33 ? vec3(0.58, 0.30, 0.18) // terracotta red
      : h < 0.50 ? vec3(0.40, 0.38, 0.36) // slate gray
      : h < 0.67 ? vec3(0.45, 0.28, 0.16) // warm brown
      : h < 0.83 ? vec3(0.52, 0.34, 0.22) // cedar brown
      :             vec3(0.32, 0.30, 0.28);// dark slate
  } else if (zoneCat < 0.3) {
    // Residential High: Paris zinc, dark slate
    c = h < 0.25 ? vec3(0.45, 0.45, 0.48) // zinc gray
      : h < 0.50 ? vec3(0.30, 0.30, 0.32) // dark slate
      : h < 0.75 ? vec3(0.38, 0.36, 0.34) // warm dark gray
      :             vec3(0.35, 0.38, 0.42);// blue-gray slate
  } else if (zoneCat < 0.5) {
    // Commercial Low: European shop roofs
    c = h < 0.20 ? vec3(0.55, 0.28, 0.16) // terracotta
      : h < 0.40 ? vec3(0.35, 0.22, 0.14) // dark brown
      : h < 0.60 ? vec3(0.38, 0.36, 0.34) // dark gray
      : h < 0.80 ? vec3(0.42, 0.25, 0.15) // warm brown tile
      :             vec3(0.30, 0.30, 0.28);// charcoal
  } else if (zoneCat < 0.7) {
    // Commercial High: flat modern roofs
    c = h < 0.33 ? vec3(0.32, 0.34, 0.36) // dark flat gray
      : h < 0.66 ? vec3(0.38, 0.42, 0.40) // green-gray (copper patina)
      :             vec3(0.28, 0.30, 0.32);// charcoal
  } else if (zoneCat < 0.9) {
    // Industrial: metal roofing
    c = h < 0.25 ? vec3(0.55, 0.56, 0.58) // light silver metal
      : h < 0.50 ? vec3(0.40, 0.40, 0.42) // medium gray metal
      : h < 0.75 ? vec3(0.50, 0.35, 0.25) // rusted metal
      :             vec3(0.35, 0.36, 0.38);// dark metal
  } else {
    // Office: modern flat roofs
    c = h < 0.33 ? vec3(0.30, 0.32, 0.35) // dark gray flat
      : h < 0.66 ? vec3(0.25, 0.28, 0.30) // very dark
      :             vec3(0.35, 0.35, 0.38);// medium gray
  }
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
  // 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶，也不吃分區的
  // 立面規則 —— 否則屋頂上的設備會長出一格一格的窗。
  bool isDetail = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)};
  // 地面貼片：柏油、鋪面、標線。自己一個分支，否則會落到牆的分支 ——
  // 柏油地面上長出一格一格的窗。
  bool isGround = vPartType > ${glslFloat(PART_THRESHOLDS.GROUND_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.GROUND_MAX)};
  bool isRoof = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_MIN)} || (n.y > 0.85 && vPartType < ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)});
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
  } else if (isDetail) {
    // 略帶藍的中灰金屬，靠種子微調明度，避免整片設備同一個顏色
    float m = 0.42 + vSeed.z * 0.16;
    color = vec3(m, m * 1.02, m * 1.06) * lighting;
  } else if (isGround) {
    // 柏油 -> 混凝土 -> 磚鋪，由頂點的 B 通道決定。加一點世界座標雜訊，
    // 否則一整片鋪面是死板的單一色塊。
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
    // 每棟樓自己的立面節奏。以前這些是常數，所以整座城市的塔樓共用同一個
    // 窗戶格；量體再怎麼變，立面看起來還是同一棟。
    float seedRhythm = vSeed.x;
    // 相位偏移只改起算點，不改尺度 —— 窗戶仍是真實世界尺寸，但相鄰建築的
    // 窗戶不再橫向對齊成一條線。
    float phase = vSeed.y * 10.0;
    float floorHeight = mix(0.22, 0.30, seedRhythm);
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

    // ---- RESIDENTIAL LOW: painted siding, no window grid ----
    if (vZoneCat < 0.1) {
      color = vBldgColor * 0.9;
      if (onWall) {
        // 水平壁板（保留原本的質感）
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        vec3 wallColor = vBldgColor * (0.88 - line * 0.06);

        // 住宅的窗比公寓大而稀疏，一層一排
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

        // 一樓正中央開一道門，取代那一格窗
        bool doorRow = y < houseFloor;
        float doorX = abs(fract(fx) - 0.5);
        float doorMask = (doorRow && doorX < 0.18 && y < houseFloor * 0.78) ? 1.0 : 0.0;
        winMask = doorRow ? 0.0 : winMask;

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
    }

    // ---- RESIDENTIAL HIGH: medium-spaced windows ----
    else if (vZoneCat < 0.3) {
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
    }

    // ---- COMMERCIAL LOW: storefront glass bottom, simple wall above ----
    else if (vZoneCat < 0.5) {
      if (onWall && y < 0.22) {
        // Large storefront glass
        float glassU = fract(wallU / 0.25);
        bool inGlass = glassU > 0.06 && glassU < 0.94;
        if (inGlass) {
          float r = hash21(floor(vec2(wallU / 0.25, 0.0)) + floor(vWorldPos.xz + 0.5) * 3.7);
          color = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        } else {
          color = vBldgColor * 0.6; // mullion
        }
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
    }

    // ---- COMMERCIAL HIGH: dense glass curtain wall ----
    else if (vZoneCat < 0.7) {
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
    }
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

  // Window day/night appearance
  if (windowMask > 0.01) {
    // Per-building random offset so lights turn on gradually during dusk
    float bldgRand = fract(sin(dot(floor(vWorldPos.xz), vec2(12.9898, 78.233))) * 43758.5453);
    float onOffset = bldgRand * 0.3; // stagger over 0.3 sunIntensity range
    float dayFactor = smoothstep(0.25 + onOffset, 0.55 + onOffset, sunIntensity);
    float nightFactor = 1.0 - smoothstep(0.15 + onOffset, 0.5 + onOffset, sunIntensity);
    // Daytime: all windows show blue-white glass reflection
    vec3 dayGlass = vec3(0.6, 0.72, 0.82);
    color = mix(color, dayGlass * lighting * shadowVal, dayFactor * windowMask);
    // Specular sun reflection on sun-facing glass only
    vec3 viewDirH = normalize(vec3(cameraPosition.x - vWorldPos.x, 0.0, cameraPosition.z - vWorldPos.z));
    vec3 sunDirH = normalize(vec3(sunDir.x, 0.0, sunDir.z));
    float facingSun = max(dot(n, sunDirH), 0.0);
    vec3 halfDirH = normalize(sunDirH + viewDirH);
    float spec = pow(max(dot(n, halfDirH), 0.0), 24.0);
    color += spec * sunColor * 0.8 * dayFactor * windowMask * facingSun * rawShadow;
    // Nighttime: only lit windows show warm yellow glow
    if (isLitWindow) {
      vec3 warmGlow = vec3(0.95, 0.85, 0.5);
      color = mix(color, warmGlow * 1.35 * winBrightness, nightFactor * 0.7);
    }
  }

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

/** 測試用：清掉 singleton，讓下一次 getBuildingMaterial 重新建立。 */
export function resetBuildingMaterial(): void {
  _buildingMaterial = null;
}

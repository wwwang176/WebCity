
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
// 函式體由 ColorPalettes.ROOF_PALETTE_TABLE 產生 —— 顏色寫在那裡才測得到。
vec3 getRoofColor(float zoneCat, float h) {
  vec3 c = vec3(0.35, 0.35, 0.38);
  if (zoneCat < 0.1) {
    c = h < 0.16666666666666666 ? vec3(0.35, 0.22, 0.14)
      : h < 0.3333333333333333 ? vec3(0.58, 0.3, 0.18)
      : h < 0.5 ? vec3(0.4, 0.38, 0.36)
      : h < 0.6666666666666666 ? vec3(0.45, 0.28, 0.16)
      : h < 0.8333333333333334 ? vec3(0.52, 0.34, 0.22)
      : vec3(0.32, 0.3, 0.28);
  } else if (zoneCat < 0.3) {
    c = h < 0.25 ? vec3(0.45, 0.45, 0.48)
      : h < 0.5 ? vec3(0.3, 0.3, 0.32)
      : h < 0.75 ? vec3(0.38, 0.36, 0.34)
      : vec3(0.35, 0.38, 0.42);
  } else if (zoneCat < 0.5) {
    c = h < 0.2 ? vec3(0.24, 0.29, 0.35)
      : h < 0.4 ? vec3(0.3, 0.36, 0.43)
      : h < 0.6 ? vec3(0.19, 0.23, 0.29)
      : h < 0.8 ? vec3(0.36, 0.42, 0.49)
      : vec3(0.27, 0.34, 0.42);
  } else if (zoneCat < 0.7) {
    c = h < 0.3333333333333333 ? vec3(0.32, 0.34, 0.36)
      : h < 0.6666666666666666 ? vec3(0.38, 0.42, 0.4)
      : vec3(0.28, 0.3, 0.32);
  } else if (zoneCat < 0.9) {
    c = h < 0.25 ? vec3(0.55, 0.56, 0.58)
      : h < 0.5 ? vec3(0.4, 0.4, 0.42)
      : h < 0.75 ? vec3(0.5, 0.35, 0.25)
      : vec3(0.35, 0.36, 0.38);
  } else {
    c = h < 0.3333333333333333 ? vec3(0.3, 0.32, 0.35)
      : h < 0.6666666666666666 ? vec3(0.25, 0.28, 0.3)
      : vec3(0.35, 0.35, 0.38);
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

  bool isFoliage = vPartType > 0.35 && vPartType < 0.65;
  // 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶，也不吃分區的
  // 立面規則 —— 否則屋頂上的設備會長出一格一格的窗。
  bool isDetail = vPartType > 0.1
    && vPartType < 0.25;
  // 自己會發光的東西：燈頭、側招、廣告看板。與 isDetail 分開是必要的 ——
  // 水塔與管架不該在晚上亮起來，而標籤只有一個的話唯一的選擇是兩者都不亮。
  bool isLamp = vPartType > 0.25
    && vPartType < 0.35;
  // 地面貼片：柏油、鋪面、標線。自己一個分支，否則會落到牆的分支 ——
  // 柏油地面上長出一格一格的窗。
  bool isGround = vPartType > 0.65
    && vPartType < 0.8;
  bool isRoof = vPartType > 0.8 || (n.y > 0.85 && vPartType < 0.1);
  bool isFloor = n.y < -0.85;

  vec3 color;

  // 這一塊白天是不是玻璃。1 = 整片換成天空反射並吃陽光鏡面（一般窗戶）；
  // 0 = 完全不反射（工業的捲門夜裡會透光，但它不是玻璃）。落地窗取中間值 ——
  // 它白天已經有自己的玻璃色與逐扇變化，整片換成統一的反射色會把那個變化抹掉。
  float glassiness = 1.0;
  // 自發光。夜晚才加，而且加在陰影之後 —— 招牌與燈頭不會被自己的建築遮住。
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
    // 燈罩／招牌面板。白天是灰白的板子，晚上自己發光。
    float g = 0.62 + vSeed.z * 0.12;
    color = vec3(g, g * 0.98, g * 0.94) * lighting;
    // **沒有人的建築不該亮。** 燒毀與空置的建築 occupancy 是 0，招牌就跟著暗。
    // 用 smoothstep 而不是 step：半空的樓不必整排招牌一起熄。
    emissive = vec3(1.0, 0.86, 0.58) * 0.95 * smoothstep(0.0, 0.15, vOccupancy);
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
    // 樓層高度的實體在 propBands.FLOOR_HEIGHT_UNITS —— 幾何（雨遮掛在哪）
    // 與 shader（窗戶畫在哪）對不上的話，雨遮會壓在窗戶中間，而那不會有
    // 任何東西報錯。
    float floorHeight = mix(0.22, 0.3, seedRhythm);
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

        // 一樓開一道門。位置必須綁在**建築**上，不能只看格內偏移：以 fract
        // 量到牆中央的距離對每一格都成立，所以一面牆 1.5–2.3 格、四面牆繞
        // 一圈，一棟房子會長出六到八道門（BUG-233）。
        //
        // fragment shader 裡每棟固定的量只有格子座標與牆面法線，所以用格子
        // 擲一面牆，再用格心對齊那面牆的中央。
        vec2 bldgCell = floor(vWorldPos.xz + 0.5);
        float wallCentre = (abs(n.x) > abs(n.z)) ? bldgCell.y : bldgCell.x;
        float doorSide = floor(hash21(bldgCell * 3.1 + 7.0) * 4.0);
        float thisSide = (abs(n.x) > abs(n.z))
          ? (n.x > 0.0 ? 0.0 : 1.0)
          : (n.z > 0.0 ? 2.0 : 3.0);
        bool doorRow = y < houseFloor;
        // 半寬照舊是 0.18 格，只是改成量世界座標而不是 fract —— 實際寬度
        // 不變（0.93–1.4 m）。
        bool onDoorWall = abs(doorSide - thisSide) < 0.5;
        float doorMask = (doorRow && onDoorWall
          && abs(wallU - wallCentre) < houseWin * 0.18
          && y < houseFloor * 0.78) ? 1.0 : 0.0;
        // 一樓其餘的地方照樣開窗。以前這裡是 winMask = 0 —— 整層一樓沒有窗，
        // 所以它拿不到 windowMask：沒有玻璃、沒有天空反射，夜裡也永遠不亮。
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
        // 落地窗：一整層樓高的玻璃，中間只有豎向窗框，**不切樓層橫線** ——
        // 這正是它與樓上那些小窗長得不一樣的原因，要保留。
        //
        // 上緣用 SHOPFRONT_CEILING 而不是自己寫一個 0.22：雨遮就掛在這條線上，
        // 兩邊各寫一份的話，雨遮會壓在落地窗中間。
        float bay = wallU / 0.25;
        float bayU = fract(bay);
        float fwB = fwidth(bay);
        float glass = smoothstep(0.06 - fwB, 0.06 + fwB, bayU)
                    * smoothstep(0.94 + fwB, 0.94 - fwB, bayU);
        vec2 wid = floor(vec2(bay, 0.0)) + floor(vWorldPos.xz + 0.5) * 3.7;
        float r = hash21(wid);
        vec3 glassColor = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        color = mix(vBldgColor * 0.6, glassColor, glass); // 窗框 -> 玻璃

        // 這一扇的店今晚有沒有開。逐扇而不是逐棟 —— 一排店面全暗或全亮都不對。
        float sPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float sPhase = hash21(wid * 2.71 + 47.0) * sPeriod;
        float sEpoch = floor((uTime + sPhase) / sPeriod);
        float sLit = hash21(wid + sEpoch * 13.7);
        // 店面比樓上的辦公室更常亮著 —— 一條商店街的夜景主角就是它。
        float litThreshSF = mix(0.95, 0.25, occ);
        if (sLit > litThreshSF) {
          winBrightness = 0.7 + hash21(wid + 21.3) * 0.5;
          isLitWindow = glass > 0.5;
        }
        windowMask = glass;
        // 落地窗白天已經有自己的玻璃色與逐扇變化。整片換成統一的天空反射色
        // 會把那個變化抹掉，所以只取一部分。
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

        // 高窗帶。廠房的窗開得高 —— 下面那一段牆要靠著放料架與機具，所以
        // 它不是一格一格的小窗，是一條沿著樓板線下方的長條窗。
        // 靠既有的樓層節奏定位，所以一層樓的廠房與三層樓的都對得上。
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
        // 廠房夜裡亮的窗比住宅少 —— 只有值夜班的那幾跨。
        float litThreshIN = mix(0.98, 0.6, occ);
        vec3 winColor;
        if (wLit > litThreshIN) {
          // 偏冷白：廠房用的是金屬鹵素／LED，不是住家的黃光。
          winColor = mix(vec3(0.90, 0.92, 0.80), vec3(0.78, 0.84, 0.72), wLit) * 0.85;
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = bandMask > 0.5;
        } else {
          winColor = vBldgColor * 0.22 + vec3(0.04, 0.05, 0.07);
        }
        color = mix(color, winColor, bandMask);
        windowMask = bandMask;

        // Large loading door at ground level
        // **畫在高窗之後**，所以它蓋掉落在同一段高度的高窗 —— 矮樓層的廠房
        // 高窗帶會落進捲門的高度範圍，兩者疊在一起就是一扇長了窗戶的捲門。
        float doorU = fract(wallU / 0.35);
        if (y < 0.18 && doorU > 0.12 && doorU < 0.88) {
          color = vBldgColor * 0.4 + vec3(0.02, 0.02, 0.01);
          // Horizontal door slats
          float slat = fract(y / 0.03);
          color *= 0.9 + 0.1 * step(0.5, slat);

          // 有些捲門是開著的，裡面的燈光整片透出來。
          // glassiness = 0：捲門會透光，但它不是玻璃 —— 白天不該變成一片藍，
          // 也不該有陽光鏡面。
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

  // 日夜係數算在 windowMask 的判斷**之外** —— 招牌與燈頭沒有窗戶，
  // 但它們一樣要知道現在是不是晚上。
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

  // 自發光加在陰影之後：燈與招牌自己就是光源，被自己的建築遮住沒有道理。
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

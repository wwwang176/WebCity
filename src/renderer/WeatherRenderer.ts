import * as THREE from 'three';
import { Season } from '../core/climate/Climate';
import { type SceneManager } from './SceneManager';
import { ViewMode } from '../core/ViewMode';

/**
 * Handles day/night cycle lighting, weather particle effects (rain/snow),
 * and seasonal visual changes (terrain color tinting).
 */
export class WeatherRenderer {
  private sceneManager: SceneManager;

  // Day/night state — smooth real-time cycle
  private timeOfDay = 0.3; // 0..1 (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)
  private readonly dayDuration = 60; // seconds for one full day/night cycle at 1x speed

  // Particle systems
  private rainSystem: THREE.Points | null = null;
  private snowSystem: THREE.Points | null = null;
  private particleCount = 3000;

  // Current weather/season
  private currentSeason: Season = Season.SPRING;
  private isRaining = false;
  private isSnowing = false;

  // Seasonal ground tint mesh (overlay)
  private seasonOverlay: THREE.Mesh | null = null;
  private mapSize = 60;

  // Exposed sun intensity for other renderers
  private _sunIntensity = 0.8;

  // Scratch colour to avoid per-frame allocation for sky
  private readonly _scratchSky = new THREE.Color();

  // Underground mode flag
  private _underground = false;

  // Base light values (daytime defaults)
  private readonly baseSkyColor = new THREE.Color(0x87ceeb);
  private readonly baseAmbientIntensity = 0.6;
  private readonly baseDirectionalIntensity = 0.8;
  private readonly baseHemiIntensity = 0.3;

  /**
   * The backdrop beyond the map, and how much of it survives at night.
   *
   * This is not the sky: in an isometric orthographic view it covers a large share of the screen.
   * Driven by the sky keyframes, sunset floods the whole screen with `_sunsetSky`'s saturated
   * orange-red and the city disappears into it. So its hue is fixed at a desaturated cool
   * blue-grey and only its brightness follows the day.
   *
   * What this changes is the **backdrop**, not the light: the hemisphere light still takes
   * `skyColor`, so sunset's warmth on building roofs is unaffected.
   */
  private readonly _backdropDay = new THREE.Color(0xaeb8c2);
  private readonly _backdropNight = new THREE.Color(0x2c333a);
  private readonly _scratchBackdrop = new THREE.Color();

  // Colour keyframes — reusable (avoids 15 new Color() per frame)
  private readonly _nightSky   = new THREE.Color(0x0a0a2e);
  private readonly _sunriseSky = new THREE.Color(0x8899cc);
  private readonly _sunsetSky  = new THREE.Color(0xff4422);
  /**
   * Night's ambient light and moonlight.
   *
   * At `0x2244aa` and `0x3355aa`, blue is five times red, leaving the red channel at 7% after the
   * multiply and turning every warm colour in the city black at night. Raising the brightness
   * alone only makes the screen bluer, so they are desaturated as well: still blue, which is where
   * night's character lives, without crushing the other two channels.
   */
  private readonly _ambNight   = new THREE.Color(0x5a72b8);
  private readonly _ambSunrise = new THREE.Color(0x99aacc);
  private readonly _ambDay     = new THREE.Color(0xfff8f0);
  private readonly _ambSunset  = new THREE.Color(0xffaa66);
  private readonly _dirNight   = new THREE.Color(0x6b83c4);
  private readonly _dirSunrise = new THREE.Color(0xccaaff);
  private readonly _dirDay     = new THREE.Color(0xfffff0);
  private readonly _dirSunset  = new THREE.Color(0xff5522);
  private readonly _hemiNight  = new THREE.Color(0x111122);
  private readonly _hemiDay    = new THREE.Color(0x556633);
  private readonly _hemiSunset = new THREE.Color(0x332211);

  constructor(sceneManager: SceneManager, mapSize: number) {
    this.sceneManager = sceneManager;
    this.mapSize = mapSize;
  }

  /**
   * Update weather visuals each frame.
   * @param dt - delta time in seconds
   * @param gameSpeed - current game speed multiplier (0=paused, 1/2/3)
   * @param season - current season from GameClock
   */
  update(dt: number, gameSpeed: number, season: Season): void {
    // Smooth real-time day/night cycle (not tied to discrete ticks)
    if (gameSpeed > 0) {
      this.timeOfDay += (dt * gameSpeed) / this.dayDuration;
      this.timeOfDay %= 1;
    }

    this.updateDayNightCycle();
    this.updateSeasonVisuals(season);
    this.updateWeatherParticles(dt, season);
  }

  /** Current directional light (sun) intensity. 0 at night, ~0.64 at noon. */
  get sunIntensity(): number {
    return this._sunIntensity;
  }

  /** Position within the day, 0..1: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  get dayFraction(): number {
    return this.timeOfDay;
  }

  /**
   * Jumps straight to a moment in the day.
   *
   * `update()` only moves time forward, so dragging a slider through the day is impossible without
   * this. The showcase needs it, and a debug panel's "jump to night" would too. Values outside
   * 0..1 take their fractional part, negatives included.
   */
  setDayFraction(t: number): void {
    const wrapped = t % 1;
    this.timeOfDay = wrapped < 0 ? wrapped + 1 : wrapped;
    this.updateDayNightCycle();
  }

  /** Switch to underground visual mode (fixed white lighting, no weather). */
  setViewMode(mode: ViewMode): void {
    const hidden = mode !== ViewMode.NORMAL;
    this._underground = hidden;
    if (this.rainSystem) this.rainSystem.visible = !hidden;
    if (this.snowSystem) this.snowSystem.visible = !hidden;
    if (this.seasonOverlay) this.seasonOverlay.visible = !hidden;
  }

  // ── Day/Night Cycle ──────────────────────────────────────────

  private updateDayNightCycle(): void {
    // Underground mode: fixed neutral white lighting, time keeps ticking
    if (this._underground) {
      (this.sceneManager.scene.background as THREE.Color).set(0xd8dce0);
      this.sceneManager.ambientLight.intensity = 0.55;
      this.sceneManager.ambientLight.color.setHex(0xffffff);
      this.sceneManager.directionalLight.intensity = 0.5;
      this.sceneManager.directionalLight.color.setHex(0xffffff);
      this.sceneManager.sunOffset.set(0, 80, 50);
      this.sceneManager.directionalLight.castShadow = false;
      this.sceneManager.hemisphereLight.intensity = 0.25;
      this.sceneManager.hemisphereLight.color.setHex(0xffffff);
      this._sunIntensity = 0.5;
      return;
    }

    // Sun angle (still used for sun sky-position)
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sunFactor = Math.max(0, Math.sin(sunAngle));

    const t = this.timeOfDay;

    // Time boundaries (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)
    const SR_START = 0.19; // sunrise begins
    const SR_PEAK  = 0.27; // sunrise peak colour
    const SR_END   = 0.36; // sunrise → day complete
    const SS_START = 0.63; // golden hour begins
    const SS_PEAK  = 0.73; // sunset peak colour
    const SS_END   = 0.88; // sunset → night complete (extended for slower decay)

    // ── Brightness: 6-segment ramp matching colour keyframes ──
    // Night's floor. Raising it is what makes terrain and buildings visible; desaturating the
    // colours (see `_ambNight`) is the other half of the same change — moving this number alone
    // makes night bluer rather than more legible.
    const NIGHT_FLOOR = 0.30;
    const PEAK_BRIGHTNESS = 0.6;
    let brightness: number;
    if (t < SR_START || t >= SS_END) {
      brightness = NIGHT_FLOOR;
    } else if (t < SR_PEAK) {
      brightness = NIGHT_FLOOR + (PEAK_BRIGHTNESS - NIGHT_FLOOR) * (t - SR_START) / (SR_PEAK - SR_START);
    } else if (t < SR_END) {
      brightness = PEAK_BRIGHTNESS + (1 - PEAK_BRIGHTNESS) * (t - SR_PEAK) / (SR_END - SR_PEAK);
    } else if (t < SS_START) {
      brightness = 1;
    } else if (t < SS_PEAK) {
      brightness = 1 - (1 - PEAK_BRIGHTNESS) * (t - SS_START) / (SS_PEAK - SS_START);
    } else {
      brightness = PEAK_BRIGHTNESS - (PEAK_BRIGHTNESS - NIGHT_FLOOR) * (t - SS_PEAK) / (SS_END - SS_PEAK);
    }

    // ── Sky colour ──
    // Still computed, but fed only to the hemisphere light; the backdrop takes the fixed hue
    // below.
    const skyColor = this._scratchSky;
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      this._nightSky, this._sunriseSky, this.baseSkyColor, this._sunsetSky, skyColor);

    // ── Backdrop: fixed hue, with only its brightness following the day ──
    // Both ends are written as their own colours rather than the day colour times a factor:
    // `THREE.Color`'s hex is sRGB while the arithmetic is linear, so multiplying by 0.3 looks like
    // 0.58. Stated at both ends, what the eye sees is what is written here.
    const nightToDay = (brightness - NIGHT_FLOOR) / (1 - NIGHT_FLOOR);
    (this.sceneManager.scene.background as THREE.Color).copy(
      this._scratchBackdrop.copy(this._backdropNight).lerp(this._backdropDay, nightToDay),
    );

    // ── Ambient light ──
    this.sceneManager.ambientLight.intensity = 0.05 + brightness * (this.baseAmbientIntensity - 0.05);
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      this._ambNight, this._ambSunrise, this._ambDay, this._ambSunset,
      this.sceneManager.ambientLight.color);

    // ── Directional light (sun / moon) ──
    const moonBase = 0.08;
    this._sunIntensity = moonBase + brightness * (this.baseDirectionalIntensity - moonBase);
    this.sceneManager.directionalLight.intensity = this._sunIntensity;
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      this._dirNight, this._dirSunrise, this._dirDay, this._dirSunset,
      this.sceneManager.directionalLight.color);

    /**
     * The sun's elevation floor. Below the horizon the light comes from underneath and buildings
     * light from below, so it stops here rather than actually setting. The cost is that at night
     * its direction is frozen at nine degrees of elevation.
     */
    const SUN_ELEVATION_FLOOR = 0.1;
    /** The elevation factor at which shadows become fully solid. */
    const SHADOW_FULL_AT = 0.30;

    // ── Shadow strength follows the sun's elevation ──
    //
    // It cannot follow the brightness curve: those are two different schedules. Brightness starts
    // climbing at SR_START (0.19), while the floor above keeps the sun frozen in place until
    // `sunFactor` passes 0.1, around t = 0.266. Driven by brightness, shadows appear before the sun
    // has started moving, sit rigid, and then abruptly begin to shorten once it clears the floor —
    // on screen, "it has been light for a while and the shadows have only just started moving".
    //
    // Tied to `sunFactor`, shadows are visible only while the sun is genuinely moving. At night
    // `sunFactor` is 0 and so is the strength, so the long shadow frozen at nine degrees all night
    // never appears.
    const shadowStrength = Math.min(1, Math.max(0,
      (sunFactor - SUN_ELEVATION_FLOOR) / (SHADOW_FULL_AT - SUN_ELEVATION_FLOOR)));
    this.sceneManager.directionalLight.shadow.intensity = shadowStrength;
    // At zero strength the whole shadow pass is switched off: a fully transparent shadow still
    // redraws a 2048-square depth map every frame, measured at about 0.24 ms per frame on an empty
    // map and scaling with the city. Both are tied to the same number, so neither "switched off but
    // still visible" nor "invisible but still drawn" can happen.
    this.sceneManager.directionalLight.castShadow = shadowStrength > 0;

    // Sun position based on time
    const sunX = 50 * Math.cos(sunAngle);
    const sunY = 80 * Math.max(SUN_ELEVATION_FLOOR, sunFactor);
    const sunZ = 50;
    this.sceneManager.sunOffset.set(sunX, sunY, sunZ);

    // ── Hemisphere light ──
    this.sceneManager.hemisphereLight.intensity = 0.01 + brightness * (this.baseHemiIntensity - 0.01);
    this.sceneManager.hemisphereLight.color.copy(skyColor);
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      this._hemiNight, this._hemiDay, this._hemiDay, this._hemiSunset,
      this.sceneManager.hemisphereLight.groundColor);
  }

  /**
   * Blend between 4 colour keyframes (night / sunrise / day / sunset)
   * using linear timeOfDay so transitions take equal real-time seconds.
   */
  private timeBlend(
    t: number,
    srStart: number, srPeak: number, srEnd: number,
    ssStart: number, ssPeak: number, ssEnd: number,
    night: THREE.Color, sunrise: THREE.Color,
    day: THREE.Color, sunset: THREE.Color,
    out: THREE.Color,
  ): void {
    if (t < srStart || t >= ssEnd) {
      out.copy(night);
    } else if (t < srPeak) {
      out.copy(night).lerp(sunrise, (t - srStart) / (srPeak - srStart));
    } else if (t < srEnd) {
      out.copy(sunrise).lerp(day, (t - srPeak) / (srEnd - srPeak));
    } else if (t < ssStart) {
      out.copy(day);
    } else if (t < ssPeak) {
      out.copy(day).lerp(sunset, (t - ssStart) / (ssPeak - ssStart));
    } else {
      out.copy(sunset).lerp(night, (t - ssPeak) / (ssEnd - ssPeak));
    }
  }

  // ── Seasonal Visuals ─────────────────────────────────────────

  private updateSeasonVisuals(season: Season): void {
    if (season === this.currentSeason && this.seasonOverlay) return;
    this.currentSeason = season;

    // Remove old overlay
    if (this.seasonOverlay) {
      this.sceneManager.scene.remove(this.seasonOverlay);
      this.seasonOverlay.geometry.dispose();
      (this.seasonOverlay.material as THREE.Material).dispose();
      this.seasonOverlay = null;
    }

    // Determine seasonal tint
    let tintColor: number;
    let opacity: number;

    switch (season) {
      case Season.SPRING:
        tintColor = 0x90ee90; // Light green
        opacity = 0.05;
        break;
      case Season.SUMMER:
        tintColor = 0x228b22; // Deep green
        opacity = 0.03;
        break;
      case Season.AUTUMN:
        tintColor = 0xcc7722; // Orange-brown (fall foliage)
        opacity = 0.08;
        break;
      case Season.WINTER:
        tintColor = 0xeeeeff; // White-blue (snow/frost)
        opacity = 0.15;
        break;
    }

    const geo = new THREE.PlaneGeometry(this.mapSize, this.mapSize);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: tintColor,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
    });
    this.seasonOverlay = new THREE.Mesh(geo, mat);
    this.seasonOverlay.position.set(this.mapSize / 2 - 0.5, 0.01, this.mapSize / 2 - 0.5);
    this.seasonOverlay.renderOrder = 1;
    this.sceneManager.scene.add(this.seasonOverlay);

    // Toggle snow/rain based on season
    this.updateWeatherState(season);
  }

  private updateWeatherState(season: Season): void {
    const wasRaining = this.isRaining;
    const wasSnowing = this.isSnowing;

    this.isRaining = season === Season.SPRING || season === Season.AUTUMN;
    this.isSnowing = season === Season.WINTER;

    if (wasRaining && !this.isRaining) this.removeRain();
    if (wasSnowing && !this.isSnowing) this.removeSnow();
    if (!wasRaining && this.isRaining) this.createRain();
    if (!wasSnowing && this.isSnowing) this.createSnow();
  }

  // ── Weather Particles ────────────────────────────────────────

  private createRain(): void {
    if (this.rainSystem) return;

    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = Math.random() * this.mapSize;
      positions[i * 3 + 1] = Math.random() * 30 + 5;
      positions[i * 3 + 2] = Math.random() * this.mapSize;
      velocities[i] = 15 + Math.random() * 10; // Fall speed
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

    const material = new THREE.PointsMaterial({
      color: 0x9999cc,
      size: 0.15,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.rainSystem = new THREE.Points(geometry, material);
    this.sceneManager.scene.add(this.rainSystem);
  }

  private createSnow(): void {
    if (this.snowSystem) return;

    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount);
    const drifts = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = Math.random() * this.mapSize;
      positions[i * 3 + 1] = Math.random() * 25 + 5;
      positions[i * 3 + 2] = Math.random() * this.mapSize;
      velocities[i] = 2 + Math.random() * 3; // Slow fall
      drifts[i] = Math.random() * Math.PI * 2; // Horizontal drift phase
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
    geometry.setAttribute('drift', new THREE.BufferAttribute(drifts, 1));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.25,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });

    this.snowSystem = new THREE.Points(geometry, material);
    this.sceneManager.scene.add(this.snowSystem);
  }

  private updateWeatherParticles(dt: number, _season: Season): void {
    if (this.rainSystem) this.updateRain(dt);
    if (this.snowSystem) this.updateSnow(dt);
  }

  private updateRain(dt: number): void {
    if (!this.rainSystem) return;
    const positions = this.rainSystem.geometry.attributes['position'] as THREE.BufferAttribute;
    const velocities = this.rainSystem.geometry.attributes['velocity'] as THREE.BufferAttribute;

    for (let i = 0; i < this.particleCount; i++) {
      const y = positions.getY(i) - velocities.getX(i) * dt;
      if (y < 0) {
        positions.setX(i, Math.random() * this.mapSize);
        positions.setY(i, 25 + Math.random() * 10);
        positions.setZ(i, Math.random() * this.mapSize);
      } else {
        positions.setY(i, y);
      }
    }
    positions.needsUpdate = true;
  }

  private updateSnow(dt: number): void {
    if (!this.snowSystem) return;
    const positions = this.snowSystem.geometry.attributes['position'] as THREE.BufferAttribute;
    const velocities = this.snowSystem.geometry.attributes['velocity'] as THREE.BufferAttribute;
    const drifts = this.snowSystem.geometry.attributes['drift'] as THREE.BufferAttribute;

    for (let i = 0; i < this.particleCount; i++) {
      const y = positions.getY(i) - velocities.getX(i) * dt;
      const driftPhase = drifts.getX(i) + dt * 2;
      drifts.setX(i, driftPhase);

      if (y < 0) {
        positions.setX(i, Math.random() * this.mapSize);
        positions.setY(i, 20 + Math.random() * 10);
        positions.setZ(i, Math.random() * this.mapSize);
      } else {
        positions.setX(i, positions.getX(i) + Math.sin(driftPhase) * dt * 0.5);
        positions.setY(i, y);
        positions.setZ(i, positions.getZ(i) + Math.cos(driftPhase * 0.7) * dt * 0.3);
      }
    }
    positions.needsUpdate = true;
    drifts.needsUpdate = true;
  }

  private removeRain(): void {
    if (this.rainSystem) {
      this.sceneManager.scene.remove(this.rainSystem);
      this.rainSystem.geometry.dispose();
      (this.rainSystem.material as THREE.Material).dispose();
      this.rainSystem = null;
    }
  }

  private removeSnow(): void {
    if (this.snowSystem) {
      this.sceneManager.scene.remove(this.snowSystem);
      this.snowSystem.geometry.dispose();
      (this.snowSystem.material as THREE.Material).dispose();
      this.snowSystem = null;
    }
  }

  dispose(): void {
    this.removeRain();
    this.removeSnow();
    if (this.seasonOverlay) {
      this.sceneManager.scene.remove(this.seasonOverlay);
      this.seasonOverlay.geometry.dispose();
      (this.seasonOverlay.material as THREE.Material).dispose();
      this.seasonOverlay = null;
    }
  }
}

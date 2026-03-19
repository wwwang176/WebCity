import * as THREE from 'three';
import { type Season } from '../core/climate/Climate';
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
  private currentSeason: Season = 'spring';
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

  /** Switch to underground visual mode (fixed white lighting, no weather). */
  setViewMode(mode: ViewMode): void {
    const hidden = mode !== ViewMode.NORMAL;
    this._underground = hidden;
    if (this.rainSystem) this.rainSystem.visible = !hidden;
    if (this.snowSystem) this.snowSystem.visible = !hidden;
    if (this.seasonOverlay) this.seasonOverlay.visible = !hidden;
  }

  /** @deprecated Use setViewMode instead. */
  setUndergroundMode(enabled: boolean): void {
    this.setViewMode(enabled ? ViewMode.UNDERGROUND : ViewMode.NORMAL);
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

    // ── Brightness: linear ramp with a night floor ──
    const NIGHT_FLOOR = 0.15;
    let brightness: number;
    if (t < SR_START || t >= SS_END) {
      brightness = NIGHT_FLOOR;
    } else if (t < SR_END) {
      brightness = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * (t - SR_START) / (SR_END - SR_START);
    } else if (t < SS_START) {
      brightness = 1;
    } else {
      brightness = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * (1 - (t - SS_START) / (SS_END - SS_START));
    }

    // ── Sky colour ──
    const nightSky   = new THREE.Color(0x0a0a2e);
    const sunriseSky = new THREE.Color(0xff9966);
    const daySky     = this.baseSkyColor;
    const sunsetSky  = new THREE.Color(0xff4422);

    const skyColor = this._scratchSky;
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      nightSky, sunriseSky, daySky, sunsetSky, skyColor);
    (this.sceneManager.scene.background as THREE.Color).copy(skyColor);

    // ── Ambient light ──
    this.sceneManager.ambientLight.intensity = 0.05 + brightness * (this.baseAmbientIntensity - 0.05);
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      new THREE.Color(0x2244aa),  // night: cool blue moonlight
      new THREE.Color(0xffd4a0),  // sunrise: warm peach
      new THREE.Color(0xfff8f0),  // day: warm white
      new THREE.Color(0xffaa66),  // sunset: deep amber
      this.sceneManager.ambientLight.color);

    // ── Directional light (sun / moon) ──
    const moonBase = 0.08;
    this._sunIntensity = moonBase + brightness * (this.baseDirectionalIntensity - moonBase);
    this.sceneManager.directionalLight.intensity = this._sunIntensity;
    this.sceneManager.directionalLight.castShadow = brightness > 0.05;
    this.timeBlend(t, SR_START, SR_PEAK, SR_END, SS_START, SS_PEAK, SS_END,
      new THREE.Color(0x3355aa),  // night: blue moonlight
      new THREE.Color(0xff8833),  // sunrise: warm orange
      new THREE.Color(0xfffff0),  // day: warm white
      new THREE.Color(0xff5522),  // sunset: deep orange-red
      this.sceneManager.directionalLight.color);

    // Sun position based on time
    const sunX = 50 * Math.cos(sunAngle);
    const sunY = 80 * Math.max(0.1, sunFactor);
    const sunZ = 50;
    this.sceneManager.sunOffset.set(sunX, sunY, sunZ);

    // ── Hemisphere light ──
    this.sceneManager.hemisphereLight.intensity = 0.01 + brightness * (this.baseHemiIntensity - 0.01);
    this.sceneManager.hemisphereLight.color.copy(skyColor);
    if (t >= SS_START || t < SR_START) {
      this.sceneManager.hemisphereLight.groundColor.setHex(0x111122);
    } else {
      this.sceneManager.hemisphereLight.groundColor.setHex(0x556633);
    }
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
      case 'spring':
        tintColor = 0x90ee90; // Light green
        opacity = 0.05;
        break;
      case 'summer':
        tintColor = 0x228b22; // Deep green
        opacity = 0.03;
        break;
      case 'autumn':
        tintColor = 0xcc7722; // Orange-brown (fall foliage)
        opacity = 0.08;
        break;
      case 'winter':
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

    this.isRaining = season === 'spring' || season === 'autumn';
    this.isSnowing = season === 'winter';

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

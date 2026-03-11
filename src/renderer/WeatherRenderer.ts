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
      this.sceneManager.directionalLight.position.set(0, 80, 50);
      this.sceneManager.directionalLight.castShadow = false;
      this.sceneManager.hemisphereLight.intensity = 0.25;
      this.sceneManager.hemisphereLight.color.setHex(0xffffff);
      this._sunIntensity = 0.5;
      return;
    }

    // Compute sun factor: 1.0 at noon, 0.0 at midnight
    // Using a sine curve that peaks at timeOfDay=0.5 (noon)
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sunFactor = Math.max(0, Math.sin(sunAngle));
    const smoothFactor = sunFactor * sunFactor; // Ease for smoother transitions

    // Sky color: blue during day, dark blue at night
    const nightSky = new THREE.Color(0x0a0a2e);
    const dawnSky = new THREE.Color(0xff7b47);
    const daySky = this.baseSkyColor.clone();

    let skyColor: THREE.Color;
    if (sunFactor < 0.15) {
      // Night
      skyColor = nightSky;
    } else if (sunFactor < 0.4) {
      // Dawn/dusk - blend from night to dawn orange to day blue
      const t = (sunFactor - 0.15) / 0.25;
      skyColor = nightSky.clone().lerp(dawnSky, t);
    } else if (sunFactor < 0.6) {
      // Dawn→Day transition
      const t = (sunFactor - 0.4) / 0.2;
      skyColor = dawnSky.clone().lerp(daySky, t);
    } else {
      skyColor = daySky;
    }

    (this.sceneManager.scene.background as THREE.Color).copy(skyColor);

    // Ambient light: dimmer at night (0.05 at midnight → 0.6 at noon)
    this.sceneManager.ambientLight.intensity = 0.05 + smoothFactor * (this.baseAmbientIntensity - 0.05);
    // Tint ambient light warm at dawn/dusk
    if (sunFactor > 0.15 && sunFactor < 0.5) {
      this.sceneManager.ambientLight.color.setHex(0xffeedd);
    } else {
      this.sceneManager.ambientLight.color.setHex(0xffffff);
    }

    // Directional light (sun): intensity and color; disable shadows at night
    this._sunIntensity = smoothFactor * this.baseDirectionalIntensity;
    this.sceneManager.directionalLight.intensity = this._sunIntensity;
    this.sceneManager.directionalLight.castShadow = smoothFactor > 0.05;
    if (sunFactor < 0.5) {
      // Warm orange during dawn/dusk
      const warmth = 1 - sunFactor * 2;
      const sunColor = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff9944), warmth * 0.5);
      this.sceneManager.directionalLight.color.copy(sunColor);
    } else {
      this.sceneManager.directionalLight.color.setHex(0xffffff);
    }

    // Move sun position based on time
    const sunX = 50 * Math.cos(sunAngle);
    const sunY = 80 * Math.max(0.1, sunFactor);
    const sunZ = 50;
    this.sceneManager.directionalLight.position.set(sunX, sunY, sunZ);

    // Hemisphere light (0.01 at midnight → 0.3 at noon)
    this.sceneManager.hemisphereLight.intensity = 0.01 + smoothFactor * (this.baseHemiIntensity - 0.01);
    this.sceneManager.hemisphereLight.color.copy(skyColor);
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

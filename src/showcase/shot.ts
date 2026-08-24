/**
 * The screenshot page for a single civic building.
 *
 * The showcase (`main.ts`) lays all nineteen out at once and the camera has to pull back beyond any
 * clear detail; reaching one means dragging by hand, and that position cannot be reproduced. This
 * page puts one building at the origin with the camera and the time decided entirely by the query, so
 * one URL always yields the same image and before-and-after comparisons are possible.
 *
 * `?type=water&rot=0.6&el=0.1&pad=1.4&t=0.42`
 */
import { SceneManager } from '../renderer/SceneManager';
import { WeatherRenderer } from '../renderer/WeatherRenderer';
import { Season } from '../core/climate/Climate';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { createShowcaseGround } from './ground';
import { placeCivic } from './civic';
import { getCivicPlan } from '../renderer/geometry/civic/registry';
import { createShowcaseTrack } from './track';
import { getInfraConfig, type InfraType } from '../core/building/InfraConfig';

const q = new URLSearchParams(location.search);
const num = (k: string, dflt: number) => Number(q.get(k) ?? dflt);
const type = (q.get('type') ?? 'water') as InfraType;

const container = document.getElementById('scene')!;
const sceneManager = new SceneManager(container);
sceneManager.scene.add(createShowcaseGround(60));

const weather = new WeatherRenderer(sceneManager, 60);
weather.update(0, 1, Season.SUMMER);
weather.setDayFraction(num('t', 0.42));

getBuildingMaterial().uniforms.uTime!.value = num('u', 37);

const plan = getCivicPlan(type);
if (plan) placeCivic(plan, sceneManager.scene, 1);

// A train station is built **on** track, so the real rails run through the middle of it. That track
// is drawn by `TrackRenderer`, which this page does not otherwise have (see `track.ts`).
if (type === 'train_station') sceneManager.scene.add(createShowcaseTrack());

const cfg = getInfraConfig(type);
sceneManager.setCameraTarget(0, 0);
const want = ((cfg?.width ?? 1) + (cfg?.height ?? 1)) * 0.62 * num('pad', 1.35);
sceneManager.zoomCamera(want - (sceneManager.camera.top - sceneManager.camera.bottom));
sceneManager.orbitCamera(num('rot', 0), num('el', 0));

document.getElementById('tag')!.textContent =
  `${cfg?.name ?? type}　${cfg?.width ?? 1}×${cfg?.height ?? 1} 格`;

sceneManager.start();

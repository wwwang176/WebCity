/**
 * 單棟公共建築的截圖頁。
 *
 * 展示區（`main.ts`）一次排十九棟，鏡頭要拉到看不清細節的高度；要看某一棟
 * 得手動拖曳，而那個位置沒有辦法重現。這一頁把一棟擺在原點、鏡頭與時間全部
 * 由 query 決定，所以同一個網址永遠得到同一張圖 —— 可以拿來比對前後。
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

const cfg = getInfraConfig(type);
sceneManager.setCameraTarget(0, 0);
const want = ((cfg?.width ?? 1) + (cfg?.height ?? 1)) * 0.62 * num('pad', 1.35);
sceneManager.zoomCamera(want - (sceneManager.camera.top - sceneManager.camera.bottom));
sceneManager.orbitCamera(num('rot', 0), num('el', 0));

document.getElementById('tag')!.textContent =
  `${cfg?.name ?? type}　${cfg?.width ?? 1}×${cfg?.height ?? 1} 格`;

sceneManager.start();

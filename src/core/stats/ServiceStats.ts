import type { GameState } from '../simulation/GameState';
import { getResidentialServiceRatios } from '../service/ServiceCoverageQuery';
import { shareFacilityLoad } from './facilityLoad';

/**
 * 服務 —— Overview 的 Services 頁。
 *
 * ## 容量只算得動的那幾座
 *
 * 停電的警局不提供任何巡邏。把它的容量加進全市總量,等於用一個城市拿不到的數字
 * 去除全城的負載 —— 面板會顯示「還有餘裕」而街上正在失控（BUG-138、BUG-100）。
 * 所以 `capacity` 只加總 `operational` 的設施,壞掉的照樣列在 `facilities` 裡
 * （玩家要看得到它壞了），但 `capacity` 不計入。
 *
 * ## 面板的分組是分組，不是資料
 *
 * 畫面把 Water 跟 Sewage 併成一組、Police 跟 Fire 併成一組，那是版面的事。
 * 這裡一個服務一筆，各自帶自己的覆蓋率 —— 併起來容易，拆開來難。
 */

export interface FacilityStat {
  /** 這座設施在做什麼。`school` 另外用 `subtype` 分小學／中學／大學。 */
  kind: string;
  subtype?: string;
  load: number;
  /** 這一座的帳面容量。壞掉時照樣是帳面值 —— 服務層的 `capacity` 才是過濾後的。 */
  capacity: number;
  /** 有電有水而且接得到路。false 代表這座現在什麼都不做。 */
  operational: boolean;
  /** 學校才有:想讀這一間的學生數。超過容量就是招生不足。 */
  demand?: number;
  /** 掩埋場才有:這一座每週燒掉多少。 */
  burnedPerWeek?: number;
  /** 墓園才有:這一座每週火化幾具。 */
  crematedPerWeek?: number;
}

export interface ServiceStat {
  service: string;
  /** 住宅區被這個服務蓋到的比例，0–1。 */
  coverage: number;
  facilities: FacilityStat[];
  /** 全市負載。 */
  load: number;
  /** 全市可用容量 —— **只加總還在運作的設施**。 */
  capacity: number;
  /** `load > capacity`。容量是 0 時也算短缺（全城停電正是最該亮燈的時候）。 */
  shortage: boolean;
}

export interface ServicesStats {
  services: ServiceStat[];
  /** 九項覆蓋率的平均。面板左上角那個百分比。 */
  avgCoverage: number;
  /** 覆蓋率不到一半的服務數。面板右上角那個「Gaps」。 */
  gaps: number;

  /** 全市供需，跟 Infra 頁同一組數字。 */
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;

  sewageProduced: number;
  sewageUntreated: number;

  activeFires: number;

  garbageUncollected: number;
  garbageProducedPerWeek: number;
  garbageBurnedPerWeek: number;

  /** 還沒被收走的遺體。 */
  deathsAwaitingPickup: number;
  deathsPerWeek: number;
  cremationsPerWeek: number;
}

/** 這一週的總和。`undefined` 代表這座設施沒有在記。 */
function weekTotal(daily: readonly number[] | undefined): number {
  return daily ? Math.round(daily.reduce((a, b) => a + b, 0)) : 0;
}

export function buildServicesStats(state: GameState): ServicesStats {
  const r = getResidentialServiceRatios(state);
  const services: ServiceStat[] = [];

  /** 收一個服務。`capacity` 只加運作中的那幾座。 */
  const add = (service: string, coverage: number, facilities: FacilityStat[]): void => {
    let load = 0;
    let capacity = 0;
    for (const f of facilities) {
      load += f.load;
      if (f.operational) capacity += f.capacity;
    }
    // 容量 0 也算短缺。舊的 `capacity > 0 && load > capacity` 在全城停電時
    // 把警示關掉了 —— 正是最該亮的時候（BUG-138）。
    services.push({ service, coverage, facilities, load, capacity, shortage: load > capacity });
  };

  // ── 電 ──
  const pwrSupply = state.power.getSupply();
  const pwrDemand = state.power.getDemand();
  add('power', r.poweredRatio, state.power.getPlants().map(p => ({
    kind: 'powerPlant',
    // 每座分到的負載按它的產出佔比。發電廠沒有「壞掉」的狀態,產出本身就是 0。
    load: pwrSupply > 0 ? Math.round(pwrDemand * p.output / pwrSupply) : 0,
    capacity: Math.round(p.output),
    operational: true,
  })));

  // ── 水 ──
  const wtrSupply = state.water.getSupply();
  const wtrDemand = state.water.getDemand();
  add('water', r.wateredRatio, state.water.getPlants().map(w => ({
    kind: 'waterPlant',
    load: wtrSupply > 0 ? Math.round(wtrDemand * w.output / wtrSupply) : 0,
    capacity: Math.round(w.output),
    operational: true,
  })));

  // ── 污水 ──
  const sewageProduced = Math.round(state.sewage.getProduced());
  const sewageSplit = shareFacilityLoad(
    sewageProduced,
    state.sewage.getTreatmentPlants(),
    tp => tp.capacity,
    tp => state.sewage.isPlantActive(tp.id),
  );
  add('sewage', r.sewageRatio, sewageSplit.shares.map(s => ({
    kind: 'sewagePlant', load: s.load, capacity: s.capacity, operational: s.active,
  })));

  // ── 警察 ──
  add('police', r.policeRatio, state.police.getStations().map(s => ({
    kind: 'policeStation',
    load: state.police.getStationLoad(s.id),
    capacity: s.capacity,
    operational: state.police.isFacilityOperationalById(s.id),
  })));

  // ── 消防 ──
  add('fire', r.fireRatio, state.fire.getStations().map(s => ({
    kind: 'fireStation',
    load: state.fire.getStationLoad(s.id),
    capacity: s.capacity,
    operational: state.fire.isFacilityOperationalById(s.id),
  })));

  // ── 醫療 ──
  add('health', r.healthRatio, state.health.getHospitals().map(h => ({
    kind: 'hospital',
    load: state.health.getHospitalLoad(h.id),
    capacity: h.capacity,
    operational: state.health.isFacilityOperationalById(h.id),
  })));

  // ── 教育 ──
  add('education', r.educationRatio, state.education.getSchools().map(s => ({
    kind: 'school',
    subtype: String(s.type),
    load: state.education.getSchoolEnrollment(s.id),
    capacity: s.capacity,
    operational: state.education.isSchoolOperational(s.id),
    // 在學人數頂多等於容量;想讀的人可以更多。差額就是要再蓋幾間的依據。
    demand: state.education.getSchoolDemand(s.id),
  })));

  // ── 垃圾 ──
  add('garbage', r.garbageRatio, state.garbage.getFacilities().map(f => ({
    kind: 'landfill',
    load: f.currentLoad,
    capacity: f.capacity,
    // 掩埋場的可用與否已經反映在 getTotalCapacity 的過濾裡,這裡逐座回報同一件事。
    operational: true,
    burnedPerWeek: weekTotal(f.burnDaily),
  })));

  // ── 殯葬 ──
  add('deathCare', r.deathCareRatio, state.deathCare.getCemeteries().map(c => ({
    kind: 'cemetery',
    load: c.currentLoad,
    capacity: c.capacity,
    operational: true,
    crematedPerWeek: weekTotal(c.recentDaily),
  })));

  const coverages = services.map(s => s.coverage);

  return {
    services,
    avgCoverage: coverages.reduce((a, b) => a + b, 0) / coverages.length,
    gaps: coverages.filter(v => v < 0.5).length,

    powerSupply: pwrSupply,
    powerDemand: pwrDemand,
    waterSupply: wtrSupply,
    waterDemand: wtrDemand,

    sewageProduced,
    sewageUntreated: state.sewage.getUntreated(),

    activeFires: state.fire.getActiveFires().length,

    garbageUncollected: state.garbage.getUncollected(),
    garbageProducedPerWeek: state.garbage.getProducedPerWeek(),
    garbageBurnedPerWeek: state.garbage.getBurnedPerWeek(),

    deathsAwaitingPickup: state.deathCare.getPendingDeathQueue().length,
    deathsPerWeek: state.deathCare.getRecentDeaths(),
    cremationsPerWeek: state.deathCare.getRecentCremations(),
  };
}

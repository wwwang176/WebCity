import { getInfraConfigById, getRotatedSize } from '../building/InfraConfig';
import { RESERVED_TO_ROTATION } from '../building/InfraPlacement';

/**
 * 每張圖層上「影響的製造點」。
 *
 * 圖層畫的是結果:哪裡有消防涵蓋、哪裡通勤很久、哪裡沒電。結果本身不會告訴玩家
 * 該去動哪一棟建築 —— 一片紅色可能是缺一座新的局，也可能是既有那一座接不到路。
 * 所以每張圖層再標一次原因，用同一個藍色:**藍色就是這些顏色的來源**。
 *
 * 這個語彙先出現在通勤圖層（站牌標青色，紅色的住宅離站有多遠一眼看得出來），
 * 這裡把它推到每一張有設施可指的圖層。
 */

/** 製造點的顏色。跨圖層固定，玩家只要學一次。 */
export const OVERLAY_SOURCE_COLOR = 0x00e5ff;

export interface OverlaySourcePos {
  x: number;
  y: number;
}

/** 查佔地要用的最小地圖介面。 */
export interface OverlaySourceGrid {
  getCell(x: number, y: number): { buildingId: number; reserved: number } | null;
}

/**
 * 各服務只需要暴露「設施在哪裡」。名稱刻意照各自既有的方法，不另外包一層 ——
 * 包了就得有人維護那層對照表，而它會跟服務一起漂走。
 */
export interface OverlaySourceContext {
  power: { getPlants(): readonly OverlaySourcePos[] };
  water: { getPlants(): readonly OverlaySourcePos[] };
  police: { getStations(): readonly OverlaySourcePos[] };
  fire: { getStations(): readonly OverlaySourcePos[] };
  health: { getHospitals(): readonly OverlaySourcePos[] };
  education: { getSchools(): readonly OverlaySourcePos[] };
  parks: { getParks(): readonly OverlaySourcePos[] };
  garbage: { getFacilities(): readonly OverlaySourcePos[] };
  /** 大眾運輸的站牌。它們散在各個運輸系統裡，不是單一服務，由呼叫端組好。 */
  transitStops: readonly OverlaySourcePos[];
}

/**
 * 圖層 → 製造那張圖上顏色的設施。
 *
 * 沒列到的圖層就是沒有可以指的東西:土地價值、污染、車流、分區、用地都是整座
 * 城市共同的結果，硬指一棟只會誤導。
 */
const OVERLAY_SOURCES: Record<string, (ctx: OverlaySourceContext) => readonly OverlaySourcePos[]> = {
  power: c => c.power.getPlants(),
  water: c => c.water.getPlants(),
  police: c => c.police.getStations(),
  // 犯罪率圖上的紅色，是「這裡離警局多遠」的結果 —— 製造點跟治安圖層是同一批。
  crime: c => c.police.getStations(),
  fire: c => c.fire.getStations(),
  health: c => c.health.getHospitals(),
  education: c => c.education.getSchools(),
  park: c => c.parks.getParks(),
  garbage: c => c.garbage.getFacilities(),
  commute: c => c.transitStops,
};

/** 這張圖層有沒有可以指的製造點。 */
export function hasOverlaySources(type: string): boolean {
  return type in OVERLAY_SOURCES;
}

/**
 * 這張圖層上所有製造點佔到的格子。
 *
 * 回傳的是**佔地的每一格**，不是錨點。高亮是拿格子座標去查的，而多格建築掛在
 * 佔地中心（`x + (w-1)/2` 四捨五入）—— 2×2 的消防局錨點在 (10,10)，要查的是
 * (11,11)。只給錨點的話這些建築一棟都不會亮。
 */
export function overlaySourceCells(
  grid: OverlaySourceGrid,
  ctx: OverlaySourceContext,
  type: string,
): OverlaySourcePos[] {
  const pick = OVERLAY_SOURCES[type];
  if (!pick) return [];

  const out: OverlaySourcePos[] = [];
  for (const f of pick(ctx)) {
    const cell = grid.getCell(f.x, f.y);
    const cfg = cell ? getInfraConfigById(cell.buildingId) : undefined;
    if (!cfg) {
      // 查不到就標錨點。設施剛被拆、或存檔裡的位置已經超出這張地圖。
      out.push({ x: f.x, y: f.y });
      continue;
    }
    const { w, h } = getRotatedSize(cfg.width, cfg.height, RESERVED_TO_ROTATION[cell!.reserved] ?? 0);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        out.push({ x: f.x + dx, y: f.y + dy });
      }
    }
  }
  return out;
}

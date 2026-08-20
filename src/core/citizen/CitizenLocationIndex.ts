import { EducationLevel } from './types';

/**
 * 「哪一棟樓住了幾個人、哪一棟樓有幾個人上班」的索引。
 *
 * 服務負載（警局、消防隊、醫院、學校）算的是**每一格**的需求，而同一棟樓裡的
 * 住戶算出來完全一樣 —— 座標、覆蓋、污染、分區都只跟樓有關。原本每個服務各自
 * 逐市民掃一遍，每位市民付兩次 `parsePosKey`、兩次 `getCoverage`、一次 `getCell`，
 * 然後往陣列裡塞一個小物件。12 萬人的城市光是警消就配置約 24 萬個物件，而不重複
 * 的位置只有幾千個（實測 12 434 人住在 103 棟住宅裡）。
 *
 * 先數成「每一格幾個人」再去查，昂貴的查詢就從 O(人口) 掉到 O(建築)。逐市民的
 * 部分只剩下一次 Map 加一。
 *
 * 這**不是**近似:下游 (`distributeLoadToNearest`、`SchoolService.updateLoads`、
 * `HealthService.updateLoads`) 對同一格的條目只做加總，先加起來再送進去結果一樣。
 */
export interface CitizenLocationIndex {
  /** `homeId` → 住在這裡的人數。 */
  readonly homeCounts: ReadonlyMap<string, number>;
  /** `homeId` → 各學歷各住了幾個人。只有警局的需求權重看學歷。 */
  readonly homeEducation: ReadonlyMap<string, ReadonlyMap<EducationLevel, number>>;
  /** `workplaceId` → 在這裡上班的人數。 */
  readonly workCounts: ReadonlyMap<string, number>;
}

interface CitizenLike {
  homeId: string | null;
  workplaceId: string | null;
  education: EducationLevel;
}

/**
 * 掃一遍市民名單，數出每一格的人數。
 *
 * 這一趟是 O(人口)，但每位市民只做 Map 加一 —— 沒有字串解析、沒有格子查詢、
 * 沒有物件配置。四個服務共用這一份結果，取代它們各自的那一趟。
 */
export function buildCitizenLocationIndex(
  citizens: readonly CitizenLike[],
): CitizenLocationIndex {
  const homeCounts = new Map<string, number>();
  const homeEducation = new Map<string, Map<EducationLevel, number>>();
  const workCounts = new Map<string, number>();

  for (const c of citizens) {
    const home = c.homeId;
    if (home !== null) {
      homeCounts.set(home, (homeCounts.get(home) ?? 0) + 1);
      let byEdu = homeEducation.get(home);
      if (byEdu === undefined) {
        byEdu = new Map();
        homeEducation.set(home, byEdu);
      }
      byEdu.set(c.education, (byEdu.get(c.education) ?? 0) + 1);
    }
    const work = c.workplaceId;
    if (work !== null) {
      workCounts.set(work, (workCounts.get(work) ?? 0) + 1);
    }
  }

  return { homeCounts, homeEducation, workCounts };
}

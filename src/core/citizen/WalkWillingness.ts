import { EducationLevel } from './types';

/**
 * 走路在市民心裡值幾倍。
 *
 * 光比「誰比較快」表達不出願不願意走：模型裡開車與走路都是一格一單位時間，所以走
 * 一格到站牌跟開車走那一格成本相同，走路完全沒有額外的權衡。
 *
 * 差別來自教育程度。這個遊戲裡沒有獨立的收入欄位 —— 收入由教育推導（見
 * `EDUCATION_SALARY_MULTIPLIERS`），所以教育這一個軸同時代表了知識與收入。
 *
 * **低於 1 是刻意的，不是寫錯。** 交通工程的模式選擇模型一律把步行時間加權 1.5~2
 * 倍，因為對一般人來說走路的代價超過它花掉的時間。這裡讓大學畢業者落在 0.8：受過
 * 高等教育的人在意健康與環境，寧可走路，即使那樣慢一點。整條階梯因此跨過 1.0 ——
 * 「勉強忍受」與「主動選擇」是兩種不同的態度，而玩家蓋大學就是在把市民從前者推向
 * 後者，這條線把教育系統與交通系統接了起來。
 *
 * 實測（乘車 30 格、班距 12，兩端各能走幾格還願意搭捷運）：
 *
 *   權重 2.0 → 不塞車只肯走 2 格，塞到 1 才走滿
 *   權重 1.2 → 不塞車走 5 格
 *   權重 0.8 → 不塞車就走滿 8 格
 *
 * 0.8 已經到頂：8 格是捷運的硬上限，所以 0.8 與 0.6、0.4 行為完全相同。要更誇張
 * 的話該動的是 `WalkRange` 的上限，不是這裡。
 *
 * 權重只用在**比較**：市民拿加權後的時間決定要怎麼去，但通勤統計與換工作的門檻
 * 看的是實際花掉的時間。兩者混在一起的話，通勤時間圖層上會出現一個沒有人真的
 * 花掉的數字。
 */
export const WALK_DISUTILITY = {
  BY_EDUCATION: {
    [EducationLevel.NONE]: 2.0,
    [EducationLevel.ELEMENTARY]: 1.6,
    [EducationLevel.HIGH_SCHOOL]: 1.2,
    [EducationLevel.UNIVERSITY]: 0.8,
  } as Record<EducationLevel, number>,
  /**
   * 沒有指定市民時用的平均值。
   *
   * 兩個用途：舊存檔可能沒有教育欄位；以及整城的通勤統計 —— 那是一個分布，用哪
   * 一位市民的脾氣都不對。取階梯的中間。
   */
  FALLBACK: 1.4,
} as const;

/** 這位市民把步行時間放大幾倍來看待。 */
export function walkWeightOf(education: EducationLevel): number {
  return WALK_DISUTILITY.BY_EDUCATION[education] ?? WALK_DISUTILITY.FALLBACK;
}

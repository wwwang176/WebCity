import { EducationLevel } from './types';

/**
 * 走一分鐘比坐一分鐘難熬。
 *
 * 光比「誰比較快」表達不出這件事：模型裡開車與走路都是一格一單位時間，所以走一格
 * 到站牌跟開車走那一格成本相同，走路完全沒有額外的不情願。真實世界的模式選擇模型
 * 會把步行時間加權 1.5~2 倍，因為走路的代價超過它花掉的時間。
 *
 * 願不願意走是有差別的：受過教育的人更在意健康與環境，也比較不會把「非開車不可」
 * 當成理所當然。這個遊戲裡沒有獨立的收入欄位 —— 收入由教育程度推導
 * （見 `EDUCATION_SALARY_MULTIPLIERS`），所以教育這一個軸同時代表了知識與收入。
 *
 * 權重只用在**比較**：市民拿加權後的時間決定要怎麼去，但通勤統計與換工作的門檻
 * 看的是實際花掉的時間。兩者混在一起的話，通勤時間圖層上會出現一個沒有人真的
 * 花掉的數字。
 */
export const WALK_DISUTILITY = {
  BY_EDUCATION: {
    [EducationLevel.NONE]: 2.0,
    [EducationLevel.ELEMENTARY]: 1.9,
    [EducationLevel.HIGH_SCHOOL]: 1.7,
    [EducationLevel.UNIVERSITY]: 1.4,
  } as Record<EducationLevel, number>,
  /** 舊存檔可能沒有教育欄位。 */
  FALLBACK: 1.8,
} as const;

/** 這位市民把步行時間放大幾倍來看待。 */
export function walkWeightOf(education: EducationLevel): number {
  return WALK_DISUTILITY.BY_EDUCATION[education] ?? WALK_DISUTILITY.FALLBACK;
}

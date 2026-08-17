import { isWorkingAge, LIFE_STAGE_AGE } from './types';

/**
 * 市民在面板上怎麼描述。
 *
 * 放在 core 而不是各個面板裡，是因為同一件事有兩個地方在說 —— 建築面板的住戶清單
 * 與市民詳細面板 —— 而它們必須跟**總覽的統計**說同一句話。
 */

/**
 * 「Work」那一列要寫什麼。
 *
 * 有工作就寫在哪裡工作。沒工作的話，「失業」只適用於**工作年齡**的人:
 *
 * - 總覽的兩頁都只數 `isWorkingAge` / `lifeStage === ADULT` 的人，而面板原本對任何
 *   `workplaceId === null` 的人都印 Unemployed。於是一座「Full employment、662 個
 *   職缺」的城市，點開住宅一看滿滿的 Unemployed —— 數字沒錯，是那個詞用錯了。
 * - 老人是**退休**，不是失業。小孩與學生是**還沒到年紀**，也不是。
 */
export function citizenWorkLabel(citizen: {
  age: number;
  workplaceId: string | null;
  educationProgress: number;
}): string {
  if (citizen.workplaceId !== null) return citizen.workplaceId;
  if (citizen.age > LIFE_STAGE_AGE.ADULT_MAX) return 'Retired';
  if (isWorkingAge(citizen.age)) return 'Unemployed';
  return citizen.educationProgress > 0 ? 'Student' : 'Too young to work';
}
